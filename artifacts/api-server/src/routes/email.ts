import { Router } from "express";
import { userId, rateLimitByUser } from "../lib/security";
import { SendReminderBody } from "@workspace/api-zod";
import { HttpError, one, required, rows, transaction } from "../lib/store";
import { ownedEvent } from "../lib/events";
import { emailEnabled, sendEmail } from "../lib/email";
const router=Router();

router.post("/events/:id/reminder/send",async(req,res)=>{
  if(!emailEnabled()) throw new HttpError(503,"Email sending is off. Copy the message and use your mail app instead.");
  const uid=userId(req),eventId=Number(req.params.id),{message,volunteer_id}=SendReminderBody.parse(req.body);
  await ownedEvent(uid,eventId);await rateLimitByUser(uid,"email-reminder",5);
  const reservation=await transaction(async(client)=>{
    const event=required(await one("SELECT e.*,s.owner_id FROM events e JOIN series s ON s.id=e.series_id WHERE e.id=$1 FOR UPDATE OF e",[eventId],client));
    const user=await one("SELECT role FROM series_members WHERE series_id=$1 AND user_id=$2",[event.series_id,uid],client);
    if(event.owner_id!==uid&&user?.role!=="editor") throw new HttpError(403,"Only organizers can email volunteers.");
    await client.query("DELETE FROM reminder_sends WHERE event_id=$1 AND reserved_at<now()-interval '6 hours'",[eventId]);
    const previous=await one("SELECT event_id FROM reminder_sends WHERE event_id=$1",[eventId],client);
    if(previous) throw new HttpError(429,"A reminder was sent in the last six hours. Try again later.");
    const recipients=await rows(`SELECT v.id,v.name,v.email,e.name AS event_name,e.timezone,e.starts_at,
      u.email AS organizer_email,u.name AS organizer_name
      FROM volunteers v JOIN events e ON e.id=v.event_id JOIN series s ON s.id=e.series_id JOIN users u ON u.id=s.owner_id
      WHERE v.event_id=$1 AND v.status='confirmed' AND v.email_consent=true AND v.email IS NOT NULL
      AND ($2::int IS NULL OR v.id=$2) ORDER BY v.id LIMIT 101`,[eventId,volunteer_id??null],client);
    if(recipients.length>100) throw new HttpError(400,"This event has more than 100 eligible recipients. Send a smaller group from your mail app.");
    if(!recipients.length) throw new HttpError(400,"No confirmed volunteers have opted in to email.");
    await client.query("INSERT INTO reminder_sends(event_id,reserved_at) VALUES($1,now())",[eventId]);
    return recipients;
  });
  let sent=0,failed=0;
  for(const v of reservation){
    const footer=`\n\nYou are receiving this because you signed up to help with ${v.event_name}. Reply to ${v.organizer_email} to stop receiving messages.`;
    try{
      await sendEmail(v.email,`A note about ${v.event_name}`,`${message.trim()}${footer}`,v.organizer_email);
      sent++;
      await one("INSERT INTO email_log(event_id,volunteer_id,kind,status) VALUES($1,$2,'reminder','sent')",[eventId,v.id]);
    }catch{
      failed++;
      await one("INSERT INTO email_log(event_id,volunteer_id,kind,status) VALUES($1,$2,'reminder','failed')",[eventId,v.id]);
    }
  }
  res.json({sent,failed});
});
export default router;
