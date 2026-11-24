import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { ConfirmPasswordResetBody, RequestPasswordResetBody } from "@workspace/api-zod";
import { userId, passwordHash, renewSession } from "../lib/security";
import { HttpError, one, required, transaction } from "../lib/store";
import { emailEnabled, sendEmail } from "../lib/email";
import { requestOrigin } from "../lib/google-auth";
const router=Router();
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");

router.get("/account",async(req,res)=>{
  const uid=userId(req);
  const data={
    exported_at:new Date().toISOString(),
    organizer:await one("SELECT id,name,email,created_at FROM users WHERE id=$1",[uid]),
    series:await one("SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) AS data FROM series s WHERE s.owner_id=$1",[uid]),
    memberships:await one("SELECT coalesce(jsonb_agg(jsonb_build_object('series_id',series_id,'role',role)),'[]'::jsonb) AS data FROM series_members WHERE user_id=$1",[uid]),
    events:await one(`SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) AS data FROM events e JOIN series s ON s.id=e.series_id WHERE s.owner_id=$1`,[uid]),
    tasks:await one(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) AS data FROM tasks t JOIN events e ON e.id=t.event_id JOIN series s ON s.id=e.series_id WHERE s.owner_id=$1`,[uid]),
    roles:await one(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) AS data FROM roles r JOIN events e ON e.id=r.event_id JOIN series s ON s.id=e.series_id WHERE s.owner_id=$1`,[uid]),
    volunteers:await one(`SELECT coalesce(jsonb_agg((to_jsonb(v)-'token') ORDER BY v.id),'[]'::jsonb) AS data FROM volunteers v JOIN events e ON e.id=v.event_id JOIN series s ON s.id=e.series_id WHERE s.owner_id=$1`,[uid]),
    sponsors:await one(`SELECT coalesce(jsonb_agg(to_jsonb(sp) ORDER BY sp.id),'[]'::jsonb) AS data FROM sponsors sp JOIN events e ON e.id=sp.event_id JOIN series s ON s.id=e.series_id WHERE s.owner_id=$1`,[uid]),
    messages:await one(`SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb) AS data FROM messages m JOIN events e ON e.id=m.event_id JOIN series s ON s.id=e.series_id WHERE s.owner_id=$1`,[uid]),
    announcements:await one(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) AS data FROM announcements a JOIN events e ON e.id=a.event_id JOIN series s ON s.id=e.series_id WHERE s.owner_id=$1`,[uid]),
  };
  res.set("Content-Disposition","attachment; filename=encore-account-export.json").json(data);
});
router.post("/auth/password-reset",async(req,res)=>{
  const {email}=RequestPasswordResetBody.parse(req.body);
  const user=await one("SELECT id,email FROM users WHERE email=$1",[email.trim().toLowerCase()]);
  // Do not reveal whether an account exists. With no email configuration, provide
  // clear guidance rather than implying a message was delivered.
  if(user&&emailEnabled()){
    const token=randomBytes(32).toString("hex");
    await one("INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",[hash(token),user.id]);
    const link=new URL("/?reset="+encodeURIComponent(token),requestOrigin(req)).href;
    try { await sendEmail(user.email,"Reset your Encore password",`Use this one-time link within 30 minutes:\n\n${link}\n\nIf you did not request this, ignore this email.`); }
    catch(error){ req.log.warn({message:error instanceof Error?error.message:"Email failed"},"Password reset email was not sent"); }
  }
  res.json({message:emailEnabled()?"If an account uses that email, a reset link will arrive shortly.":"Password reset email is off. Ask the administrator to reset your password."});
});
router.post("/auth/password-reset/confirm",async(req,res)=>{
  const {token,password}=ConfirmPasswordResetBody.parse(req.body);
  const credential=await one("SELECT * FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()",[hash(token)]);
  if(!credential) throw new HttpError(400,"This reset link is invalid or expired.");
  const password_hash=await passwordHash(password);
  await transaction(async(client)=>{
    const locked=required(await one("SELECT * FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",[hash(token)],client),"This reset link is invalid or expired.");
    await client.query("UPDATE users SET password_hash=$1 WHERE id=$2",[password_hash,locked.user_id]);
    await client.query("UPDATE password_resets SET used_at=now() WHERE token_hash=$1",[hash(token)]);
    await client.query("DELETE FROM sessions WHERE sess->>'userId'=$1",[String(locked.user_id)]);
  });
  res.json({ok:true});
});
router.delete("/account",async(req,res)=>{
  const uid=userId(req);
  await transaction(async(client)=>{
    await client.query("DELETE FROM sessions WHERE sess->>'userId'=$1",[String(uid)]);
    required(await one("DELETE FROM users WHERE id=$1 RETURNING id",[uid],client));
  });
  await new Promise<void>((resolve,reject)=>req.session.destroy((e)=>e?reject(e):resolve()));
  res.clearCookie("encore.sid");res.clearCookie("encore.csrf");res.json({ok:true});
});
export default router;
