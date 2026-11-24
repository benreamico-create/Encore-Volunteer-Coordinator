import { Router } from "express";
import { SaveRecapBody, CreateNextEventBody, DraftStarterBody } from "@workspace/api-zod";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { userId } from "../lib/security";
import { HttpError, id, one, rows, required, transaction } from "../lib/store";
import { bundle, dueFromOffset, eventSummary, insertEvent, ownedEvent, recapData, wire } from "../lib/events";
import { saveRecapData, starterTemplate } from "../lib/recaps";
import { draft } from "../lib/ai";
import { emailEnabled } from "../lib/email";

const router=Router();
router.put("/events/:id/recap",async(req,res)=>{
  const uid=userId(req),eid=id(req.params.id),data=SaveRecapBody.parse(req.body);
  await transaction(async client=>{ await ownedEvent(uid,eid,client); await saveRecapData(eid,data,client); });
  res.json({ok:true});
});
router.post("/ai/starter",async(req,res)=>{
  const uid=userId(req),data=DraftStarterBody.parse(req.body); await ownedEvent(uid,data.event_id);
  const recap=data.recap??await recapData(data.event_id);
  if(!recap) throw new HttpError(400,"Write a wrap-up before drafting the next event starter.");
  const schema=z.object({items:z.array(z.string().min(1).max(1000)).min(3).max(7)});
  res.json(await draft(uid,"a next event starter",recap,'{items:[string]}; 3–7 imperative actions grounded only in this recap',schema,starterTemplate(recap)));
});
router.post("/events/:id/next",async(req,res)=>{
  const uid=userId(req),eid=id(req.params.id),data=CreateNextEventBody.parse(req.body);
  const next=await transaction(async client=>{
    const prev=await ownedEvent(uid,eid,client),recap=await recapData(eid,client);
    const resources=await rows("SELECT * FROM resources WHERE event_id=$1 AND use_again=true ORDER BY id",[eid],client);
    const willing=data.carry_volunteers ? await rows("SELECT * FROM volunteers WHERE event_id=$1 AND ask_again=true AND status='confirmed' ORDER BY id",[eid],client) : [];
    if(willing.length && !data.carry_roles) throw new HttpError(400,"Include roles when carrying volunteers so each person keeps their chosen role.");
    const event=await insertEvent(prev.series_id,{...prev,name:data.name,starts_at:data.starts_at},eid,client);
    if(data.carry_lessons && recap) await client.query("UPDATE events SET carried_lesson=$1,carried_didnt=$2 WHERE id=$3",[recap.top_lesson,recap.what_didnt,event.id]);
    if(data.carry_resources) for(const r of resources) await client.query("INSERT INTO resources(event_id,name,kind,note,use_again,carried_from_id) VALUES($1,$2,$3,$4,true,$5)",[event.id,r.name,r.kind,r.note,r.id]);
    const roleMap=new Map<number,number>(),volunteerMap=new Map<number,number>();
    if(data.carry_roles) for(const r of await rows("SELECT * FROM roles WHERE event_id=$1 ORDER BY sort_order,id",[eid],client)) {
      const nr=await one("INSERT INTO roles(event_id,name,instruction,slots_needed,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING id",[event.id,r.name,r.instruction,r.slots_needed,r.sort_order],client);
      roleMap.set(r.id,nr!.id);
    }
    if(data.carry_map) {
      const priorMap=await one("SELECT * FROM maps WHERE event_id=$1",[eid],client);
      if(priorMap) {
        const copiedMap=await one(
          `INSERT INTO maps(event_id,source,image_path,image_name,image_mime,image_width,image_height)
           VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [event.id,priorMap.source,priorMap.image_path,priorMap.image_name,priorMap.image_mime,priorMap.image_width,priorMap.image_height],
          client,
        );
        const keepVendorNames=new Set(
          data.carry_resources
            ? resources.filter((resource)=>resource.kind==="vendor").map((resource)=>resource.name.trim().toLowerCase())
            : [],
        );
        for(const item of await rows("SELECT * FROM map_items WHERE map_id=$1 ORDER BY sort_order,id",[priorMap.id],client)) {
          await client.query(
            `INSERT INTO map_items(map_id,kind,label,x_pct,y_pct,w_pct,h_pct,vendor_name,needs_text,role_id,sort_order)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              copiedMap!.id,item.kind,item.label,item.x_pct,item.y_pct,item.w_pct,item.h_pct,
              item.vendor_name&&keepVendorNames.has(String(item.vendor_name).trim().toLowerCase())?item.vendor_name:null,
              item.needs_text??null,
              item.role_id==null?null:(roleMap.get(Number(item.role_id))??null),
              item.sort_order,
            ],
          );
        }
      }
    }
    for(const v of willing) {
      const nv=await one("INSERT INTO volunteers(event_id,role_id,name,email,email_consent,ask_again,token) VALUES($1,$2,$3,$4,$5,true,$6) RETURNING id",[
        event.id,roleMap.get(v.role_id),v.name,v.email_consent?v.email:null,!!(v.email_consent&&v.email),randomBytes(24).toString("hex")],client);
      volunteerMap.set(v.id,nv!.id);
    }
    let sort=0;
    if(data.carry_recurring) for(const t of await rows("SELECT * FROM tasks WHERE event_id=$1 AND recurring=true ORDER BY sort_order,id",[eid],client)) {
      const oldDay=new Intl.DateTimeFormat("en-CA",{timeZone:prev.timezone}).format(new Date(prev.starts_at));
      const offset=t.due_date?Math.round((Date.parse(String(t.due_date).slice(0,10))-Date.parse(oldDay))/86400000):null;
      await client.query(`INSERT INTO tasks(event_id,title,group_name,source,source_note,recurring,due_date,sort_order,assignee_user_id,assignee_volunteer_id,role_id)
        VALUES($1,$2,$3,'carryover',$4,true,$5,$6,$7,$8,$9)`,[
        event.id,t.title,t.group_name,`From ${prev.name}`,offset===null?null:dueFromOffset(event,offset),sort++,
        t.assignee_user_id===uid?uid:null,volunteerMap.get(t.assignee_volunteer_id)??null,roleMap.get(t.role_id)??null]);
    }
    for(const text of data.items.filter(t=>t.trim())) {
      if(text.trim().length>300) throw new HttpError(400,"Keep each starter task under 300 characters before creating the next event.");
      await client.query("INSERT INTO tasks(event_id,title,group_name,source,source_note,sort_order) VALUES($1,$2,'From last event','starter',$3,$4)",[event.id,text.trim(),`From ${prev.name}`,sort++]);
    }
    return await eventSummary(event.id,client);
  });
  res.json(wire(next));
});
router.get("/events/:id/reminder",async(req,res)=>{
  const data=await bundle(userId(req),id(req.params.id));
  const event=data.event,owner=data.organizers[0];
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:event.timezone,weekday:"long",month:"long",day:"numeric",year:"numeric"}).format(new Date(event.starts_at));
  const time=new Intl.DateTimeFormat("en-CA",{timeZone:event.timezone,hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(event.starts_at));
  const origin=`${req.protocol}://${req.get("host")}`;
  const blocks=data.volunteers.filter(v=>v.status==="confirmed").map(v=>{
    const role=data.roles.find(r=>r.id===v.role_id);
     return {id:v.id,name:v.name,email:v.email_consent?v.email:null,message:`Hi ${v.name}, a reminder that ${event.name} is on ${date} at ${time} at ${event.place_text||event.city||"the place shown on your private page"}. You are on ${role?.name||"the team"}. Your page with the details is ${origin}/v/${v.token}. Reply if anything changes. Thank you for helping. — ${owner.name}`};
  });
  const general=`A reminder that ${event.name} is on ${date} at ${time} at ${event.place_text||event.city||"the place shown on your private page"}. Please review your role and your private page. Reply if anything changes. Thank you for helping. — ${owner.name}`;
  res.json({message:general,drafts:blocks.map((v)=>({id:v.id,name:v.name,email:v.email,message:v.message})),recipients:data.volunteers.filter(v=>v.email_consent&&v.email&&v.status==="confirmed").map(v=>v.email),email_enabled:emailEnabled(),notice:emailEnabled()?"Review the recipient count and message before sending. Private links are only included in individual messages.":"Email sending is off. Copy the message or open it in your own mail app."});
});
export default router;
