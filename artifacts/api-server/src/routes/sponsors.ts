import { Router } from "express";
import { CreateSponsorBody, UpdateSponsorBody, ListSponsorsResponse, CreateSponsorResponse } from "@workspace/api-zod";
import { z } from "zod";
import { userId } from "../lib/security";
import { bundle, ownedEvent, wire } from "../lib/events";
import { id, one, rows, required, HttpError, patch, type Row } from "../lib/store";
import { isCalendarDate } from "../lib/calendar-date";
import { draft } from "../lib/ai";

const router=Router();
async function validate(eventId:number,data:Row) {
  data.name=data.name.trim();
  if(!data.name) throw new HttpError(400,"Name the sponsor.");
  if(data.next_step_due!==null&&!isCalendarDate(data.next_step_due)) throw new HttpError(400,"Choose a valid next-step date (YYYY-MM-DD).");
  if(data.owner_user_id!==null) {
    const owner=await one(`SELECT u.id FROM users u JOIN series s ON s.owner_id=u.id OR EXISTS(SELECT 1 FROM series_members m WHERE m.series_id=s.id AND m.user_id=u.id AND m.role='editor')
      JOIN events e ON e.series_id=s.id WHERE e.id=$1 AND u.id=$2`,[eventId,data.owner_user_id]);
    if(!owner) throw new HttpError(400,"Choose an organizer on this event.");
  }
}
router.get("/events/:id/sponsors",async(req,res)=>{
  const eid=id(req.params.id); await ownedEvent(userId(req),eid);
  res.json(ListSponsorsResponse.parse(wire(await rows("SELECT * FROM sponsors WHERE event_id=$1 ORDER BY id",[eid]))));
});
router.post("/events/:id/sponsors",async(req,res)=>{
  const eid=id(req.params.id),data=CreateSponsorBody.parse(req.body); await ownedEvent(userId(req),eid); await validate(eid,data);
  const row=await one("INSERT INTO sponsors(event_id,name,offer_text,status,owner_user_id,amount,next_step_text,next_step_due) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[eid,data.name,data.offer_text,data.status,data.owner_user_id,data.amount,data.next_step_text,data.next_step_due]);
  res.json(CreateSponsorResponse.parse(wire(row)));
});
router.put("/events/:id/sponsors/:itemId",async(req,res)=>{
  const eid=id(req.params.id),data=UpdateSponsorBody.parse(req.body); await ownedEvent(userId(req),eid); await validate(eid,data);
  res.json(CreateSponsorResponse.parse(wire(required(await patch("sponsors",id(req.params.itemId),data,eid)))));
});
router.delete("/events/:id/sponsors/:itemId",async(req,res)=>{
  const eid=id(req.params.id); await ownedEvent(userId(req),eid);
  required(await one("DELETE FROM sponsors WHERE id=$1 AND event_id=$2 RETURNING id",[id(req.params.itemId),eid]));
  res.json({ok:true});
});
router.post("/events/:id/sponsors/:itemId/task",async(req,res)=>{
  const eid=id(req.params.id); await ownedEvent(userId(req),eid);
  const sponsor=required(await one("SELECT * FROM sponsors WHERE id=$1 AND event_id=$2",[id(req.params.itemId),eid]));
  if(!sponsor.next_step_text.trim()) throw new HttpError(400,"Write a next step first.");
  const task=await one(`INSERT INTO tasks(event_id,title,due_date,assignee_user_id,source,source_note,group_name,sort_order)
    VALUES($1,$2,$3,$4,'sponsor',$5,'Sponsors',(SELECT coalesce(max(sort_order),0)+1 FROM tasks WHERE event_id=$1)) RETURNING *`,
    [eid,sponsor.next_step_text,sponsor.next_step_due,sponsor.owner_user_id,sponsor.name]);
  res.json(wire(task));
});
router.post("/events/:id/sponsors/:itemId/draft",async(req,res)=>{
  const uid=userId(req),eid=id(req.params.id),snapshot=await bundle(uid,eid);
  const sponsor=required(await one("SELECT * FROM sponsors WHERE id=$1 AND event_id=$2",[id(req.params.itemId),eid]));
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:snapshot.event.timezone,month:"long",day:"numeric",year:"numeric"}).format(new Date(snapshot.event.starts_at));
  const message=`Hi ${sponsor.name}, a quick follow-up on ${snapshot.event.name} on ${date}. We would love to have ${sponsor.name} involved with ${sponsor.offer_text||"support for the event"}. Happy to answer any questions. — ${snapshot.organizers[0].name}`;
  res.json(await draft(uid,"a sponsor follow-up email",{event:{name:snapshot.event.name,date},sponsor:{name:sponsor.name,offer:sponsor.offer_text,status:sponsor.status,next_step:sponsor.next_step_text}},
    "{message:string}; copy-only editable draft; do not invent an email address or amounts",z.object({message:z.string().min(1).max(5000)}),{message}));
});
export default router;
