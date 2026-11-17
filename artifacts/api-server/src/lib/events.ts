import { randomBytes } from "node:crypto";
import { HttpError, one, rows, required, type Sql, sql, type Row } from "./store";

export function wire<T>(value:T):T { return JSON.parse(JSON.stringify(value)); }
export async function ownedSeries(uid:number,sid:number,client:Sql=sql) {
  return required(await one("SELECT * FROM series WHERE id=$1 AND owner_id=$2",[sid,uid],client));
}
export async function ownedEvent(uid:number,eid:number,client:Sql=sql) {
  return required(await one(`SELECT e.* FROM events e JOIN series s ON s.id=e.series_id WHERE e.id=$1 AND s.owner_id=$2`,[eid,uid],client));
}
export async function eventSummary(eid:number,client:Sql=sql) {
  return required(await one(`SELECT e.*,
    (SELECT count(*)::int FROM tasks t WHERE t.event_id=e.id AND t.status='done') AS tasks_done,
    (SELECT count(*)::int FROM tasks t WHERE t.event_id=e.id) AS tasks_total,
    (SELECT count(*)::int FROM volunteers v WHERE v.event_id=e.id AND v.status='confirmed') AS volunteers_count,
    (SELECT count(*)::int FROM roles r WHERE r.event_id=e.id) AS roles_count
    FROM events e WHERE e.id=$1`,[eid],client));
}
export async function roleList(eid:number,client:Sql=sql) {
  return rows("SELECT r.*,(SELECT count(*)::int FROM volunteers v WHERE v.role_id=r.id AND v.status='confirmed') AS filled FROM roles r WHERE r.event_id=$1 ORDER BY sort_order,id",[eid],client);
}
export async function previousData(event:Row,client:Sql=sql):Promise<Row|null> {
  const prev=event.previous_event_id ? await one("SELECT * FROM events WHERE id=$1 AND series_id=$2",[event.previous_event_id,event.series_id],client) : undefined;
  if (!prev) return null;
  return {event:await eventSummary(prev.id,client),recap:await recapData(prev.id,client),resources:await rows("SELECT * FROM resources WHERE event_id=$1 AND use_again=true ORDER BY id",[prev.id],client),tasks:await rows("SELECT * FROM tasks WHERE event_id=$1 AND recurring=true ORDER BY sort_order,id",[prev.id],client)};
}
export async function recapData(eid:number,client:Sql=sql):Promise<Row|null> {
  const recap=await one("SELECT * FROM recaps WHERE event_id=$1",[eid],client);
  if(!recap) return null;
  return {...recap,resources:await rows("SELECT * FROM resources WHERE event_id=$1 ORDER BY id",[eid],client),items:(await rows("SELECT text FROM recap_actions WHERE recap_id=$1 AND picked=true ORDER BY sort_order,id",[recap.id],client)).map(a=>a.text)};
}
export async function bundle(uid:number,eid:number,client:Sql=sql) {
  const event=await ownedEvent(uid,eid,client);
  return {
    event:await eventSummary(eid,client),series:await ownedSeries(uid,event.series_id,client),
    tasks:await rows("SELECT * FROM tasks WHERE event_id=$1 ORDER BY sort_order,id",[eid],client),
    roles:await roleList(eid,client),volunteers:await rows("SELECT * FROM volunteers WHERE event_id=$1 ORDER BY created_at DESC,id DESC",[eid],client),resources:await rows("SELECT * FROM resources WHERE event_id=$1 ORDER BY id",[eid],client),recap:await recapData(eid,client),
    previous:await previousData(event,client),
    organizers:await rows("SELECT id,name,email FROM users WHERE id=$1",[uid],client),
  };
}
export function validDate(value:string) {
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) throw new HttpError(400,"Choose a valid event date and time.");
  return new Date(value).toISOString();
}
export function validTimezone(zone:string) {
  try { new Intl.DateTimeFormat("en",{timeZone:zone}).format(); return zone; }
  catch { throw new HttpError(400,"Choose a valid timezone."); }
}
export async function insertEvent(sid:number,data:Row,previousId:number|null=null,client:Sql=sql) {
  const slug=data.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"event";
  const event=await one(`INSERT INTO events(series_id,previous_event_id,name,starts_at,timezone,city,place_text,guests_expected,budget_amount,budget_currency,description_raw,purpose_why,purpose_audience,purpose_takeaway,signup_slug)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[
    sid,previousId,data.name.trim(),validDate(data.starts_at),validTimezone(data.timezone||"America/Edmonton"),
    data.city||"",data.place_text||"",data.guests_expected??0,data.budget_amount??0,"CAD",
    data.description_raw,data.purpose_why||"",data.purpose_audience||"",data.purpose_takeaway||"",`${slug}-${randomBytes(3).toString("hex").slice(0,4)}`,
  ],client);
  return required(event);
}
export function dueFromOffset(event:Row,offset:number) {
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:event.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(event.starts_at));
  const d=new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+offset);
  return d.toISOString().slice(0,10);
}
