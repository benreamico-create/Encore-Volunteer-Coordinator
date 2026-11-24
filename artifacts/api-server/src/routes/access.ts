import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { AcceptSeriesInviteBody, CreateSeriesInviteBody, GetSeriesTeamResponse } from "@workspace/api-zod";
import { userId } from "../lib/security";
import { id, one, rows, required, HttpError, transaction } from "../lib/store";
import { ownedSeries } from "../lib/events";
export const tokenHash = (value:string) => createHash("sha256").update(value).digest("hex");

export async function seriesOwner(uid:number,sid:number) {
  return required(await one("SELECT * FROM series WHERE id=$1 AND owner_id=$2",[sid,uid]));
}
const router=Router();
// Central write barrier supplements scoped queries: viewers can read, never mutate.
router.use(async(req,_res,next)=>{
  if(["GET","HEAD","OPTIONS"].includes(req.method)) { next(); return; }
  const match=req.path.match(/^\/(events|series)\/(\d+)(?:\/|$)/);
  if(!match) { next(); return; }
  const uid=userId(req), value=id(match[2]);
  const series=match[1]==="series"
    ?await one("SELECT id,owner_id FROM series WHERE id=$1",[value])
    :await one("SELECT s.id,s.owner_id FROM series s JOIN events e ON e.series_id=s.id WHERE e.id=$1",[value]);
  required(series);
  if(series!.owner_id!==uid) {
    const member=await one("SELECT role FROM series_members WHERE series_id=$1 AND user_id=$2",[series!.id,uid]);
    if(!member) throw new HttpError(404,"Not found");
    if(member.role!=="editor") throw new HttpError(403,"This series is view-only. Ask the owner for editor access.");
  }
  next();
});
router.get("/series/:id/team",async(req,res)=>{
  const uid=userId(req),sid=id(req.params.id),series=await ownedSeries(uid,sid);
  const members=await rows(`SELECT u.id,u.name,CASE WHEN u.id=s.owner_id THEN 'owner' ELSE m.role END AS role
    FROM series s JOIN users u ON u.id=s.owner_id OR EXISTS(SELECT 1 FROM series_members sm WHERE sm.series_id=s.id AND sm.user_id=u.id)
    LEFT JOIN series_members m ON m.series_id=s.id AND m.user_id=u.id WHERE s.id=$1 ORDER BY (u.id=s.owner_id) DESC,u.id`,[sid]);
  res.json(GetSeriesTeamResponse.parse({members,is_owner:series.owner_id===uid}));
});
router.post("/series/:id/invites",async(req,res)=>{
  const sid=id(req.params.id); await seriesOwner(userId(req),sid);
  const data=CreateSeriesInviteBody.parse(req.body),token=randomBytes(24).toString("hex");
  const invite=await one("INSERT INTO series_invites(series_id,token_hash,role,expires_at) VALUES($1,$2,$3,now()+interval '7 days') RETURNING id",[sid,tokenHash(token),data.role]);
  res.json({id:invite!.id,token});
});
router.delete("/series/:id/invites/:itemId",async(req,res)=>{
  const sid=id(req.params.id); await seriesOwner(userId(req),sid);
  required(await one("UPDATE series_invites SET revoked_at=now() WHERE id=$1 AND series_id=$2 RETURNING id",[id(req.params.itemId),sid]));
  res.json({ok:true});
});
router.delete("/series/:id/team/:itemId",async(req,res)=>{
  const sid=id(req.params.id); await seriesOwner(userId(req),sid);
  required(await one("DELETE FROM series_members WHERE series_id=$1 AND user_id=$2 RETURNING user_id",[sid,id(req.params.itemId)]));
  res.json({ok:true});
});
router.post("/invites/accept",async(req,res)=>{
  const uid=userId(req),data=AcceptSeriesInviteBody.parse(req.body);
  const sid=await transaction(async(client)=>{
    const invite=required(await one("SELECT * FROM series_invites WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",[tokenHash(data.token)],client),"This invite expired or was revoked.");
    const series=required(await one("SELECT owner_id FROM series WHERE id=$1",[invite.series_id],client));
    if(series.owner_id!==uid) await client.query("INSERT INTO series_members(series_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(series_id,user_id) DO UPDATE SET role=excluded.role",[invite.series_id,uid,invite.role]);
    return invite.series_id;
  });
  res.json({series_id:sid});
});
export default router;
