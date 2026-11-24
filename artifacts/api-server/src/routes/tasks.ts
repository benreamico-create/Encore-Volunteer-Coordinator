import { Router } from "express";
import { CreateTaskBody, UpdateTaskBody, CreateRoleBody, UpdateRoleBody, AskHelperBody, AskHelperResponse } from "@workspace/api-zod";
import { userId } from "../lib/security";
import { HttpError, id, one, patch, required, rows, transaction, type Row } from "../lib/store";
import { bundle, calendarDayDelta, ownedEvent, roleList, wire } from "../lib/events";
import { draft } from "../lib/ai";
import { z } from "zod";
import { isCalendarDate } from "../lib/calendar-date";

const router=Router();
async function validateAssignee(eid:number,uid:number,data:Row) {
  if (data.assignee_user_id && data.assignee_volunteer_id) throw new HttpError(400,"Choose one assignee.");
  if (data.assignee_user_id && data.assignee_user_id!==uid) throw new HttpError(400,"That organizer is not part of this series.");
  if (data.assignee_volunteer_id) required(await one("SELECT id FROM volunteers WHERE id=$1 AND event_id=$2 AND status='confirmed'",[data.assignee_volunteer_id,eid]),"Volunteer not found");
  if (data.role_id) required(await one("SELECT id FROM roles WHERE id=$1 AND event_id=$2",[data.role_id,eid]),"Role not found");
}
function validateDueDate(data: Row) {
  if (data.due_date !== undefined && data.due_date !== null && !isCalendarDate(data.due_date)) {
    throw new HttpError(400,"Choose a valid due date (YYYY-MM-DD).");
  }
}
router.post("/events/:id/tasks",async(req,res)=>{
  const uid=userId(req),eid=id(req.params.id),data=CreateTaskBody.parse(req.body); await ownedEvent(uid,eid);
  validateDueDate(data);
  await validateAssignee(eid,uid,data);
  const max=await one("SELECT coalesce(max(sort_order),0)+1 AS n FROM tasks WHERE event_id=$1",[eid]);
  const task=await one(`INSERT INTO tasks(event_id,title,group_name,status,assignee_user_id,assignee_volunteer_id,role_id,due_date,recurring,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [eid,data.title,data.group_name||"General",data.status||"todo",data.assignee_user_id??null,data.assignee_volunteer_id??null,data.role_id??null,data.due_date||null,data.recurring??false,data.sort_order??max!.n]);
  res.json(wire(task));
});
router.patch("/events/:id/tasks/:itemId",async(req,res)=>{
  const uid=userId(req),eid=id(req.params.id),tid=id(req.params.itemId),data=UpdateTaskBody.parse(req.body); await ownedEvent(uid,eid);
  // Only validate dates supplied in this request. Status/assignment/reordering
  // must not attempt to parse a driver-returned DATE object as request text.
  validateDueDate(data);
  const task=required(await one("SELECT * FROM tasks WHERE id=$1 AND event_id=$2",[tid,eid]));
  const combined={...task,...data};
  await validateAssignee(eid,uid,combined);
  res.json(wire(await patch("tasks",tid,data,eid)));
});
router.delete("/events/:id/tasks/:itemId",async(req,res)=>{
  const eid=id(req.params.id); await ownedEvent(userId(req),eid);
  required(await one("DELETE FROM tasks WHERE id=$1 AND event_id=$2 RETURNING id",[id(req.params.itemId),eid]));
  res.json({ok:true});
});
router.post("/events/:id/roles",async(req,res)=>{
  const eid=id(req.params.id),data=CreateRoleBody.parse(req.body); await ownedEvent(userId(req),eid);
  const role=await one("INSERT INTO roles(event_id,name,instruction,slots_needed,sort_order) VALUES($1,$2,$3,$4,(SELECT coalesce(max(sort_order),0)+1 FROM roles WHERE event_id=$1)) RETURNING *",[eid,data.name,data.instruction,data.slots_needed]);
  res.json({...role,filled:0});
});
router.patch("/events/:id/roles/:itemId",async(req,res)=>{
  const uid=userId(req),eid=id(req.params.id),rid=id(req.params.itemId),data=UpdateRoleBody.parse(req.body);
  const updated=await transaction(async client=>{
    await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE",[eid]); await ownedEvent(uid,eid,client);
    const role=required((await roleList(eid,client)).find(r=>r.id===rid));
    if (data.slots_needed<role.filled) throw new HttpError(400,"Remove volunteers before reducing slots below the filled count.");
    return {...await patch("roles",rid,data,eid,client),filled:role.filled};
  });
  res.json(updated);
});
router.delete("/events/:id/roles/:itemId",async(req,res)=>{
  const uid=userId(req),eid=id(req.params.id),rid=id(req.params.itemId);
  await transaction(async client=>{
    await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE",[eid]); await ownedEvent(uid,eid,client);
    const active=await one("SELECT count(*)::int AS n FROM volunteers WHERE role_id=$1 AND event_id=$2 AND status='confirmed'",[rid,eid],client);
    if (active!.n>0) throw new HttpError(409,"Remove the volunteers in this role before deleting it.");
    required(await one("DELETE FROM roles WHERE id=$1 AND event_id=$2 RETURNING id",[rid,eid],client));
  });
  res.json({ok:true});
});
router.delete("/events/:id/volunteers/:itemId",async(req,res)=>{
  const uid=userId(req),eid=id(req.params.id),vid=id(req.params.itemId);
  await transaction(async client=>{
    await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE",[eid]); await ownedEvent(uid,eid,client);
    const v=required(await one("SELECT id FROM volunteers WHERE id=$1 AND event_id=$2",[vid,eid],client));
    await client.query("DELETE FROM tasks WHERE event_id=$1 AND assignee_volunteer_id=$2 AND source='signup'",[eid,v.id]);
    await client.query("DELETE FROM volunteers WHERE id=$1 AND event_id=$2",[v.id,eid]);
  });
  res.json({ok:true});
});
router.post("/ai/helper",async(req,res)=>{
  const uid=userId(req),data=AskHelperBody.parse(req.body),snapshot=await bundle(uid,data.event_id);
  const screen=data.screen;
  const event=snapshot.event;
  const daysToEvent=calendarDayDelta(new Date(),event.starts_at,event.timezone);
  const taskSummary=snapshot.tasks.slice(0,40).map((task:Row)=>({
    id:task.id,title:task.title,status:task.status,
    assignee:task.assignee_user_id
      ? (snapshot.organizers.find((organizer:Row)=>organizer.id===task.assignee_user_id)?.name||"Organizer")
      : task.assignee_volunteer_id
        ? (snapshot.volunteers.find((volunteer:Row)=>volunteer.id===task.assignee_volunteer_id)?.name||"Volunteer")
        : null,
    group:task.group_name,due_date:task.due_date,recurring:!!task.recurring,
  }));
  const openTasks=taskSummary.filter((task)=>task.status!=="done");
  const roles=snapshot.roles.map((role:Row)=>({
    id:role.id,name:role.name,instruction:role.instruction,slots_needed:role.slots_needed,filled:role.filled,
  }));
  const volunteers=snapshot.volunteers.filter((volunteer:Row)=>volunteer.status==="confirmed").map((volunteer:Row)=>({
    id:volunteer.id,name:volunteer.name,role_id:volunteer.role_id,
  })).slice(0,40);
  const context:Row={
    screen,question:data.question,
    event:{name:event.name,starts_at:event.starts_at,timezone:event.timezone,city:event.city,
      place_text:event.place_text,guests_expected:event.guests_expected,plan_accepted:event.plan_accepted},
    days_to_event:daysToEvent,
    task_counts:{total:snapshot.tasks.length,open:openTasks.length,done:taskSummary.filter((task)=>task.status==="done").length,
      unassigned:openTasks.filter((task)=>!task.assignee).length},
    tasks:taskSummary,roles,volunteers,
  };
  if(screen==="plan"||screen==="new_event") {
    context.event_description=String(event.description_raw??"").slice(0,1200);
    context.purpose={
      why:String(event.purpose_why??"").slice(0,500),
      audience:String(event.purpose_audience??"").slice(0,500),
      takeaway:String(event.purpose_takeaway??"").slice(0,500),
    };
  }
  if(screen==="blueprint") {
    const map=await one("SELECT id,source FROM maps WHERE event_id=$1",[data.event_id]);
    context.blueprint={
      source:map?.source??null,
      items:map?await rows("SELECT id,kind,label,vendor_name,role_id,x_pct,y_pct,w_pct,h_pct FROM map_items WHERE map_id=$1 ORDER BY sort_order,id LIMIT 60",[map.id]):[],
    };
  }
  if(screen==="wrapup") {
    const recap=snapshot.recap;
    context.wrapup=recap?{
      what_worked:recap.what_worked,what_didnt:recap.what_didnt,top_lesson:recap.top_lesson,
      picked_next_steps:recap.items.slice(0,20),
      resources:recap.resources.slice(0,20).map((resource:Row)=>({name:resource.name,kind:resource.kind,use_again:resource.use_again})),
    }:null;
  }
  if(screen==="chat") {
    const [messages,announcements]=await Promise.all([
      one("SELECT count(*)::int AS count FROM messages WHERE event_id=$1",[data.event_id]),
      one("SELECT count(*)::int AS count FROM announcements WHERE event_id=$1",[data.event_id]),
    ]);
    context.chat_counts={messages:messages?.count??0,announcements:announcements?.count??0};
  }
  if(screen==="dashboard"||screen==="new_event"||screen==="next") {
    const eventCount=await one("SELECT count(*)::int AS count FROM events WHERE series_id=$1",[snapshot.series.id]);
    context.series={name:snapshot.series.name,events_count:eventCount?.count??0};
    if(screen==="dashboard") context.latest_wrapup=snapshot.recap?{
      what_worked:snapshot.recap.what_worked,what_didnt:snapshot.recap.what_didnt,top_lesson:snapshot.recap.top_lesson,
    }:null;
    if(screen==="next") context.carry_forward=snapshot.recap?{
      top_lesson:snapshot.recap.top_lesson,
      picked_next_steps:snapshot.recap.items.slice(0,20),
      reusable_resources:snapshot.recap.resources.filter((resource:Row)=>resource.use_again).slice(0,20).map((resource:Row)=>({name:resource.name,kind:resource.kind})),
      recurring_tasks:taskSummary.filter((task)=>task.recurring),
      reusable_volunteers:volunteers.length,
    }:null;
  }
  const actions:Row[]=[];
  const taskByScreen:Record<string,{title:string;label:string}>={
    dashboard:{title:"Review the next event's open tasks",label:"Add a next-step task"},
    new_event:{title:"Confirm the event details with the team",label:"Add a planning task"},
    plan:{title:"Review the plan with the team",label:"Add a plan follow-up"},
    tasks:{title:"Brief the team before doors open",label:"Add a volunteer briefing"},
    volunteers:{title:"Confirm volunteer arrival and role details",label:"Add a volunteer briefing"},
    blueprint:{title:"Walk the venue and check each post",label:"Add a map walk-through"},
    chat:{title:"Review team decisions and open tasks",label:"Add a follow-up task"},
    wrapup:{title:"Review the items to carry forward",label:"Add a carry-over check"},
    next:{title:"Confirm carried items before the event",label:"Add a carry-over check"},
  };
  const suggestion=taskByScreen[screen];
  actions.push({type:"add_task",label:suggestion.label,payload:{title:suggestion.title}});
  const unassigned=snapshot.tasks.find((task:Row)=>!task.assignee_user_id&&!task.assignee_volunteer_id&&task.status!=="done");
  const volunteer=snapshot.volunteers.find((v:Row)=>v.status==="confirmed");
  if(unassigned&&volunteer) actions.push({type:"assign_task",label:`Assign to ${volunteer.name}`,payload:{task_id:unassigned.id,volunteer_id:volunteer.id}});
  if(screen==="volunteers"||screen==="blueprint"||screen==="plan")
    actions.push({type:"add_role",label:"Add a floating helper role",payload:{name:"Floating helper",slots_needed:1,instruction:"Check in with the organizer and help where needed."}});
  actions.push({type:"draft_message",label:"Draft a team message",payload:{message:`A quick check-in for ${snapshot.event.name}: please review your role and checklist before the event. Thank you for helping.`}});
  const templateAnswers:Record<string,string>={
    dashboard:`${event.name} is ${daysToEvent<0?"in the past":daysToEvent===0?"today":`${daysToEvent} days away`}. There are ${openTasks.length} open tasks; start with an unassigned item or review what to carry forward.`,
    new_event:`For ${event.name}, review the event details and purpose first. There are ${openTasks.length} open tasks in the current series to use as context.`,
    plan:`${event.name} has ${snapshot.tasks.length} tasks and ${roles.length} roles. Check the dates and role coverage before accepting more work.`,
    tasks:`There are ${openTasks.length} open tasks and ${context.task_counts.unassigned} unassigned. Start with work that blocks other tasks.`,
    volunteers:`${roles.filter((role)=>Number(role.filled)<Number(role.slots_needed)).length} roles still have open spots. Review instructions and coverage before sending a reminder.`,
    blueprint:`${context.blueprint?.items?.length??0} Blueprint items are placed. Check that volunteer posts are linked to roles and leave clear paths between spaces.`,
    chat:`This event has ${context.chat_counts?.messages??0} team messages. I use counts only, not message text; summarize decisions in a follow-up task if helpful.`,
    wrapup:snapshot.recap?.top_lesson?`The current top lesson is: “${String(snapshot.recap.top_lesson).slice(0,180)}”. Decide which notes and resources should carry forward.`:"No wrap-up notes are saved yet. Capture what worked, what did not, and one lesson before creating the next event.",
    next:`Review which roles, recurring tasks, reusable resources, volunteers and Blueprint items should come forward from ${event.name}.`,
  };
  const template={answer:templateAnswers[screen],actions,notice:"",ai_remaining:0};
  const validated=AskHelperResponse.omit({notice:true,ai_remaining:true});
  const result=await draft(uid,`screen-aware event helper for ${screen}`,context,
    '{answer:string,actions:[{type:"add_task"|"assign_task"|"add_role"|"draft_message",label:string,payload:{title?,task_id?,volunteer_id?,name?,instruction?,slots_needed?,message?}}]}; maximum 4 actions',validated,validated.parse(template));
  // A provider cannot apply arbitrary payloads: the same scoped CRUD validators handle each click.
  res.json(result);
});
export default router;
