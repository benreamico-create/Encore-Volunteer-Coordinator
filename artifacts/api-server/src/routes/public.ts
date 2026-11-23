import { Router } from "express";
import { randomBytes } from "node:crypto";
import { JoinEventBody, TickVolunteerTaskBody, GetSignupResponse, GetVolunteerPageResponse } from "@workspace/api-zod";
import { HttpError, id, one, required, rows, transaction, type Row } from "../lib/store";
import { rateLimit } from "../lib/security";
import { roleList, wire } from "../lib/events";

const router=Router();
export function publicEvent(e:Row,privatePage=false) {
  return {name:e.name,starts_at:e.starts_at,timezone:e.timezone,city:e.city,place_text:e.place_text,signups_open:e.signups_open,event_day_notes:privatePage?e.event_day_notes:"",day_of_contact_text:privatePage?e.day_of_contact_text:""};
}
router.get("/public/join/:slug",async(req,res)=>{
  await rateLimit(req,"public-read",1000);
  const event=required(await one("SELECT * FROM events WHERE signup_slug=$1",[String(req.params.slug)]),"This sign-up link was not found.");
  res.json(GetSignupResponse.parse(wire({event:publicEvent(event),roles:await roleList(event.id)})));
});
router.post("/public/join/:slug",async(req,res)=>{
  await rateLimit(req,"join-all",60);
  await rateLimit(req,`join:${String(req.params.slug).slice(0,80)}`,10);
  const data=JoinEventBody.parse(req.body);
  if(data.website) throw new HttpError(400,"Unable to accept this sign-up.");
  if(!data.name.trim()) throw new HttpError(400,"Please enter your name.");
  if(data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new HttpError(400,"Please check your email address.");
  const token=randomBytes(24).toString("hex");
  await transaction(async client=>{
    const event=required(await one("SELECT * FROM events WHERE signup_slug=$1 FOR UPDATE",[String(req.params.slug)],client));
    if(!event.signups_open) throw new HttpError(409,"Sign-ups are closed. Thank you for offering to help.");
    const role=required((await roleList(event.id,client)).find(r=>r.id===data.role_id),"This role is not available.");
    if(role.filled>=role.slots_needed) throw new HttpError(409,"This role is now full. Please choose another role.");
    const volunteer=await one("INSERT INTO volunteers(event_id,role_id,name,email,email_consent,ask_again,token) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[
      event.id,role.id,data.name.trim(),data.email_consent&&data.email?data.email.trim().toLowerCase():null,!!(data.email_consent&&data.email),data.ask_again,token],client);
    if(event.auto_task_from_signup) await client.query("INSERT INTO tasks(event_id,title,group_name,assignee_volunteer_id,source,sort_order) VALUES($1,$2,'Volunteers',$3,'signup',(SELECT coalesce(max(sort_order),0)+1 FROM tasks WHERE event_id=$1))",[
      event.id,`${data.name.trim()} — ${role.name}`,volunteer!.id]);
  });
  res.json({token});
});
router.get("/public/v/:token",async(req,res)=>{
  await rateLimit(req,"public-read",1000);
  const v=required(await one("SELECT * FROM volunteers WHERE token=$1",[String(req.params.token)]),"This private link was not found.");
  const event=required(await one("SELECT * FROM events WHERE id=$1",[v.event_id]));
  const role=required((await roleList(event.id)).find(r=>r.id===v.role_id));
  const tasks=await rows(`SELECT * FROM tasks WHERE event_id=$1 AND
    (assignee_volunteer_id=$2 OR (role_id=$3 AND assignee_volunteer_id IS NULL AND assignee_user_id IS NULL)) ORDER BY sort_order,id`,[event.id,v.id,role.id]);
  // Never expose other people, organizer account details, email addresses, or private tokens.
  const safeTasks=tasks.map(t=>({...t,assignee_volunteer_id:null,assignee_user_id:null}));
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:event.timezone}).format(new Date());
  const eventDate=new Intl.DateTimeFormat("en-CA",{timeZone:event.timezone}).format(new Date(event.starts_at));
  const hasMapPost = v.status === "confirmed" && !!(await one(
    `SELECT i.id FROM map_items i JOIN maps m ON m.id=i.map_id JOIN events e ON e.id=m.event_id
     WHERE e.id=$1 AND e.map_shared=true AND i.kind='station' AND i.role_id=$2 LIMIT 1`,
    [event.id, role.id],
  ));
  const announcement = await one(
    "SELECT id,body,created_at FROM announcements WHERE event_id=$1 ORDER BY id DESC LIMIT 1",
    [event.id],
  );
  res.json(GetVolunteerPageResponse.parse(wire({
    name:v.name,status:v.status,role,event:publicEvent(event,true),tasks:safeTasks,
    event_day:event.event_day_mode||today===eventDate,has_map_post:hasMapPost,
    announcement:announcement ?? null,
  })));
});
router.patch("/public/v/:token/tasks/:itemId",async(req,res)=>{
  await rateLimit(req,"public-tick",500);
  const data=TickVolunteerTaskBody.parse(req.body);
  const v=required(await one("SELECT * FROM volunteers WHERE token=$1 AND status='confirmed'",[String(req.params.token)]));
  required(await one(`UPDATE tasks SET status=$1 WHERE id=$2 AND event_id=$3 AND
    (assignee_volunteer_id=$4 OR (role_id=$5 AND assignee_volunteer_id IS NULL AND assignee_user_id IS NULL)) RETURNING id`,
    [data.done?"done":"todo",id(req.params.itemId),v.event_id,v.id,v.role_id]),"This task is not on your checklist.");
  res.json({ok:true});
});
export default router;
