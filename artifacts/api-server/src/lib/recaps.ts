import { one, rows, type Row, type Sql, required } from "./store";
export async function saveRecapData(eid:number,data:Row,client:Sql) {
  const recap=required(await one(`INSERT INTO recaps(event_id,registered,attended,what_worked,what_didnt,top_lesson,rating_overall,rating_venue,rating_volunteers)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(event_id) DO UPDATE SET registered=EXCLUDED.registered,attended=EXCLUDED.attended,
    what_worked=EXCLUDED.what_worked,what_didnt=EXCLUDED.what_didnt,top_lesson=EXCLUDED.top_lesson,
    rating_overall=EXCLUDED.rating_overall,rating_venue=EXCLUDED.rating_venue,rating_volunteers=EXCLUDED.rating_volunteers RETURNING *`,
    [eid,data.registered,data.attended,data.what_worked,data.what_didnt,data.top_lesson,data.rating_overall,data.rating_venue,data.rating_volunteers],client));
  const kept:number[]=[];
  for(const r of data.resources) {
    const existing=r.id ? await one("SELECT * FROM resources WHERE id=$1 AND event_id=$2",[r.id,eid],client) : undefined;
    const saved=existing ? await one("UPDATE resources SET name=$1,kind=$2,note=$3,use_again=$4 WHERE id=$5 AND event_id=$6 RETURNING id",[r.name,r.kind,r.note,r.use_again,existing.id,eid],client)
      : await one("INSERT INTO resources(event_id,name,kind,note,use_again) VALUES($1,$2,$3,$4,$5) RETURNING id",[eid,r.name,r.kind,r.note,r.use_again],client);
    kept.push(saved!.id);
  }
  await client.query("DELETE FROM resources WHERE event_id=$1 AND NOT(id=ANY($2::int[]))",[eid,kept]);
  await client.query("DELETE FROM recap_actions WHERE recap_id=$1",[recap.id]);
  for(const [index,text] of data.items.entries()) if(text.trim()) await client.query("INSERT INTO recap_actions(recap_id,text,sort_order) VALUES($1,$2,$3)",[recap.id,text.trim(),index]);
  await client.query("UPDATE events SET status='done' WHERE id=$1",[eid]);
}
export function starterTemplate(data:Row) {
  const items:string[]=[];
  if(data.what_didnt?.trim()) items.push(`Fix: ${data.what_didnt.trim()}`);
  if(data.what_worked?.trim()) items.push(`Repeat: ${data.what_worked.trim()}`);
  if(data.top_lesson?.trim()) items.push(`Apply your top lesson: ${data.top_lesson.trim()}`);
  for(const r of data.resources??[]) if(r.use_again) items.push(`Rebook: ${r.name}`);
  // When there is little recap text, these are grounded in the recap's own counts/resources.
  if(items.length<3) items.push(`Review the turnout: ${data.attended??0} attended from ${data.registered??0} registered`);
  if(items.length<3) items.push("Review which resources to use again");
  if(items.length<3) items.push("Record a top lesson before planning the next event");
  return {items:items.slice(0,7)};
}
