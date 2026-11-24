import { Router } from "express";
import { randomBytes } from "node:crypto";
import { JoinEventBody, TickVolunteerTaskBody, GetSignupResponse, GetVolunteerPageResponse } from "@workspace/api-zod";
import { HttpError, id, one, required, rows, transaction, type Row } from "../lib/store";
import { rateLimit } from "../lib/security";
import { roleList, wire } from "../lib/events";
import { emailEnabled, sendEmail } from "../lib/email";
import { requestOrigin } from "../lib/google-auth";

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
  const created=await transaction(async client=>{
    const event=required(await one("SELECT * FROM events WHERE signup_slug=$1 FOR UPDATE",[String(req.params.slug)],client));
    if(!event.signups_open) throw new HttpError(409,"Sign-ups are closed. Thank you for offering to help.");
    const role=required((await roleList(event.id,client)).find(r=>r.id===data.role_id),"This role is not available.");
    if(role.filled>=role.slots_needed) throw new HttpError(409,"This role is now full. Please choose another role.");
    const volunteer=await one("INSERT INTO volunteers(event_id,role_id,name,email,email_consent,ask_again,token) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[
      event.id,role.id,data.name.trim(),data.email_consent&&data.email?data.email.trim().toLowerCase():null,!!(data.email_consent&&data.email),data.ask_again,token],client);
    if(event.auto_task_from_signup) await client.query("INSERT INTO tasks(event_id,title,group_name,assignee_volunteer_id,source,sort_order) VALUES($1,$2,'Volunteers',$3,'signup',(SELECT coalesce(max(sort_order),0)+1 FROM tasks WHERE event_id=$1))",[
      event.id,`${data.name.trim()} — ${role.name}`,volunteer!.id]);
    return {id:volunteer!.id,event,role,email:data.email_consent&&data.email?data.email.trim().toLowerCase():null};
  });
  if(created.email&&emailEnabled()){
    const organizer=await one("SELECT u.name,u.email FROM users u JOIN series s ON s.owner_id=u.id JOIN events e ON e.series_id=s.id WHERE e.id=$1",[created.event.id]);
    let status="failed";
    try{
      await sendEmail(created.email,`You’re signed up for ${created.event.name}`,
        `Hi ${data.name.trim()}, your spot for ${created.event.name} as ${created.role.name} is confirmed.\n\nYour private volunteer page: ${requestOrigin(req)}/v/${token}\n\n${created.event.name} is on ${new Intl.DateTimeFormat("en-CA",{timeZone:created.event.timezone,weekday:"long",month:"long",day:"numeric"}).format(new Date(created.event.starts_at))}.\n\nYou are receiving this because you signed up to help with ${created.event.name}. Reply to ${organizer?.email||"the organizer"} to stop receiving messages.`,
        organizer?.email);
      status="sent";
    }catch{req.log.warn("Volunteer confirmation email was not sent");}
    await one("INSERT INTO email_log(event_id,volunteer_id,kind,status) VALUES($1,$2,'confirmation',$3) ON CONFLICT(volunteer_id) WHERE kind='confirmation' DO NOTHING",[created.event.id,created.id,status]);
  }
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
router.post("/public/v/:token/cancel",async(req,res)=>{
  await rateLimit(req,"volunteer-cancel",30);
  const token=String(req.params.token);
  await transaction(async(client)=>{
    const volunteer=required(await one("SELECT * FROM volunteers WHERE token=$1 FOR UPDATE",[token],client),"This private link was not found.");
    if(volunteer.status==="cancelled") return;
    if(volunteer.status!=="confirmed") throw new HttpError(409,"This volunteer spot is not active.");
    await client.query("UPDATE volunteers SET status='cancelled' WHERE id=$1",[volunteer.id]);
    // Only remove the generated signup action, never organizer-created work.
    await client.query("DELETE FROM tasks WHERE event_id=$1 AND assignee_volunteer_id=$2 AND source='signup'",[volunteer.event_id,volunteer.id]);
  });
  res.json({ok:true});
});
router.get("/public/v/:token/calendar",async(req,res)=>{
  await rateLimit(req,"volunteer-calendar",60);
  const volunteer=required(await one("SELECT v.id,v.status,v.name AS volunteer_name,r.name AS role_name,e.id AS event_id,e.name AS event_name,e.starts_at,e.timezone,e.place_text,e.city FROM volunteers v JOIN events e ON e.id=v.event_id JOIN roles r ON r.id=v.role_id WHERE v.token=$1",[String(req.params.token)]),"This private link was not found.");
  if(volunteer.status!=="confirmed") throw new HttpError(410,"This volunteer spot is no longer active.");
  const start=new Date(volunteer.starts_at),end=new Date(start.getTime()+2*60*60*1000);
  const stamp=(d:Date)=>d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
  const escape=(s:string)=>s.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
  const place=[volunteer.place_text,volunteer.city].filter(Boolean).join(", ");
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Encore//Volunteer Shift//EN","CALSCALE:GREGORIAN","BEGIN:VEVENT",
    `UID:volunteer-${volunteer.id}-event-${volunteer.event_id}@encore`,
    `DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(start)}`,`DTEND:${stamp(end)}`,
    `SUMMARY:${escape(`${volunteer.event_name} — ${volunteer.role_name}`)}`,
    `DESCRIPTION:${escape(`${volunteer.volunteer_name}'s volunteer shift for ${volunteer.event_name}`)}`,
    ...(place?[`LOCATION:${escape(place)}`]:[]),"END:VEVENT","END:VCALENDAR"];
  const body=lines.map((line)=>`${line}\r\n`).join("");
  res.set("Content-Type","text/calendar; charset=utf-8").set("Content-Disposition",'attachment; filename="encore-volunteer-shift.ics"').send(body);
});
export default router;
