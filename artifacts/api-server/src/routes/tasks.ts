import { Router } from "express";
import { CreateTaskBody, UpdateTaskBody, CreateRoleBody, UpdateRoleBody, AskHelperBody, AskHelperResponse } from "@workspace/api-zod";
import { userId } from "../lib/security";
import { HttpError, id, one, patch, required, rows, transaction, type Row } from "../lib/store";
import { bundle, ownedEvent, roleList, wire } from "../lib/events";
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
  const actions:Row[]=[];
  actions.push({type:"add_task",label:"Add a volunteer briefing",payload:{title:"Brief the team before doors open"}});
  const unassigned=snapshot.tasks.find(t=>!t.assignee_user_id&&!t.assignee_volunteer_id&&t.status!=="done");
  const volunteer=snapshot.volunteers.find((v:Row)=>v.status==="confirmed");
  if(unassigned&&volunteer) actions.push({type:"assign_task",label:`Assign to ${volunteer.name}`,payload:{task_id:unassigned.id,volunteer_id:volunteer.id}});
  actions.push({type:"add_role",label:"Add a floating helper role",payload:{name:"Floating helper",slots_needed:1,instruction:"Check in with the organizer and help where needed."}});
  actions.push({type:"draft_message",label:"Draft a team message",payload:{message:`A quick check-in for ${snapshot.event.name}: please review your role and checklist before the event. Thank you for helping.`}});
  const template={answer:"Start with unassigned work and make sure everyone knows when to arrive. These suggestions are drafts; choose what to apply.",actions,notice:"",ai_remaining:0};
  const validated=AskHelperResponse.omit({notice:true,ai_remaining:true});
  const result=await draft(uid,"helpful event actions",{question:data.question,snapshot:{event:snapshot.event,tasks:snapshot.tasks.map(t=>({id:t.id,title:t.title,status:t.status,assignee_volunteer_id:t.assignee_volunteer_id})),roles:snapshot.roles,volunteers:snapshot.volunteers.map((v:Row)=>({id:v.id,name:v.name}))}},
    '{answer:string,actions:[{type:"add_task"|"assign_task"|"add_role"|"draft_message",label:string,payload:{title?,task_id?,volunteer_id?,name?,instruction?,slots_needed?,message?}}]}; maximum 4 actions',validated,validated.parse(template));
  // A provider cannot apply arbitrary payloads: the same scoped CRUD validators handle each click.
  res.json(result);
});
export default router;
