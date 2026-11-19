import { Router } from "express";
import { CreateSeriesBody, ListSeriesResponse, CreateEventBody, GetDashboardResponse, GetEventResponse, UpdateEventBody, AcceptPlanBody, DraftPlanBody } from "@workspace/api-zod";
import { id, one, rows, transaction, patch, HttpError } from "../lib/store";
import { userId } from "../lib/security";
import { bundle, dueFromOffset, eventSummary, insertEvent, ownedEvent, ownedSeries, previousData, recapData, validDate, validTimezone, wire } from "../lib/events";
import { draft, planTemplate } from "../lib/ai";
import { z } from "zod";

const router=Router();
router.get("/series",async(req,res)=>{
  res.json(ListSeriesResponse.parse(await rows("SELECT * FROM series WHERE owner_id=$1 ORDER BY created_at,id",[userId(req)])));
});
router.post("/series",async(req,res)=>{
  const uid=userId(req),data=CreateSeriesBody.parse(req.body);
  if (!data.name.trim()) throw new HttpError(400,"Give your series a name.");
  res.json(await one("INSERT INTO series(owner_id,name,description) VALUES($1,$2,$3) RETURNING *",[uid,data.name.trim(),data.description||""]));
});
router.get("/series/:id/dashboard",async(req,res)=>{
  const uid=userId(req),sid=id(req.params.id),series=await ownedSeries(uid,sid);
  const eventRows=await rows("SELECT id FROM events WHERE series_id=$1 ORDER BY starts_at DESC,id DESC",[sid]);
  const events=await Promise.all(eventRows.map(e=>eventSummary(e.id)));
  const last=await one("SELECT e.* FROM events e JOIN recaps r ON r.event_id=e.id WHERE e.series_id=$1 ORDER BY e.starts_at DESC,e.id DESC LIMIT 1",[sid]);
  const latest=last ? {event:await eventSummary(last.id),recap:await recapData(last.id),resources:await rows("SELECT * FROM resources WHERE event_id=$1 AND use_again=true ORDER BY id",[last.id]),tasks:await rows("SELECT * FROM tasks WHERE event_id=$1 AND recurring=true ORDER BY sort_order,id",[last.id])} : null;
  const unassigned=await one("SELECT count(*)::int AS n FROM tasks t JOIN events e ON e.id=t.event_id WHERE e.series_id=$1 AND t.status!='done' AND t.assignee_user_id IS NULL AND t.assignee_volunteer_id IS NULL AND t.role_id IS NULL",[sid]);
  res.json(GetDashboardResponse.parse(wire({series,events,latest,unassigned_count:unassigned!.n,tasks_done:events.reduce((s,e)=>s+e.tasks_done,0),tasks_total:events.reduce((s,e)=>s+e.tasks_total,0)})));
});
router.post("/series/:id/events",async(req,res)=>{
  const uid=userId(req),sid=id(req.params.id),data=CreateEventBody.parse(req.body);
  await ownedSeries(uid,sid);
  if (!data.name.trim()||!data.description_raw.trim()) throw new HttpError(400,"Name and description are required.");
  const prev=await one("SELECT id FROM events WHERE series_id=$1 ORDER BY starts_at DESC,id DESC LIMIT 1",[sid]);
  const event=await insertEvent(sid,data,prev?.id??null);
  res.json(wire(await eventSummary(event.id)));
});
router.get("/events/:id",async(req,res)=>{
  res.json(GetEventResponse.parse(wire(await bundle(userId(req),id(req.params.id)))));
});
router.patch("/events/:id",async(req,res)=>{
  const eid=id(req.params.id); await ownedEvent(userId(req),eid);
  const data=UpdateEventBody.parse(req.body);
  if (data.name !== undefined) {
    data.name = data.name.trim();
    if (!data.name) throw new HttpError(400,"Give the event a name.");
  }
  if (data.description_raw !== undefined) {
    data.description_raw = data.description_raw.trim();
    if (!data.description_raw) throw new HttpError(400,"Add a description for the event.");
  }
  if (data.starts_at !== undefined) data.starts_at = validDate(data.starts_at);
  if (data.timezone !== undefined) data.timezone = validTimezone(data.timezone);
  await patch("events",eid,data);
  res.json(wire(await eventSummary(eid)));
});
router.post("/events/:id/accept-plan",async(req,res)=>{
  const uid=userId(req),eid=id(req.params.id),data=AcceptPlanBody.parse(req.body);
  await transaction(async client=>{
    // Lock makes double-click/retry idempotent and prevents duplicate tasks/roles.
    await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE",[eid]);
    const event=await ownedEvent(uid,eid,client);
    if (event.plan_accepted) return;
    let i=0;
    for (const group of data.groups) for (const t of group.tasks) {
      await client.query(`INSERT INTO tasks(event_id,group_name,title,due_date,source,source_note,sort_order) VALUES($1,$2,$3,$4,'ai_plan',$5,$6)`,[eid,group.name,t.title,dueFromOffset(event,t.due_offset_days),t.from_lesson||"",i++]);
    }
    for (const [index,r] of data.roles.entries()) await client.query("INSERT INTO roles(event_id,name,instruction,slots_needed,sort_order) VALUES($1,$2,$3,$4,$5)",[eid,r.name,r.instruction,r.slots,index]);
    await client.query("UPDATE events SET plan_accepted=true,status='upcoming' WHERE id=$1",[eid]);
  });
  res.json({ok:true});
});
router.post("/ai/plan",async(req,res)=>{
  const uid=userId(req),data=DraftPlanBody.parse(req.body),event=await ownedEvent(uid,data.event_id),prev=await previousData(event);
  const lesson=event.carried_lesson||prev?.recap?.top_lesson||"";
  const template=planTemplate(lesson);
  const schema=z.object({
    groups:z.array(z.object({name:z.string().max(120),tasks:z.array(z.object({title:z.string().min(1).max(300),due_offset_days:z.number().int().min(-365).max(365),from_lesson:z.string().max(1000).optional()}))})).max(8),
    roles:z.array(z.object({name:z.string().min(1).max(120),slots:z.number().int().min(1).max(100),instruction:z.string().max(2000)})).min(3).max(5)
  }).refine(v=>v.groups.reduce((s,g)=>s+g.tasks.length,0)>=8 && v.groups.reduce((s,g)=>s+g.tasks.length,0)<=16);
  res.json(await draft(uid,"an event plan",{event,previous:prev},'{groups:[{name,tasks:[{title,due_offset_days,from_lesson?}]}],roles:[{name,slots,instruction}]}; 8–16 tasks, 3–5 roles. Tag tasks influenced by past lessons.',schema,template));
});
export default router;
