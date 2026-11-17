import { Router } from "express";
import { randomBytes } from "node:crypto";
import { userId } from "../lib/security";
import { one, transaction } from "../lib/store";
import { insertEvent } from "../lib/events";
import { saveRecapData } from "../lib/recaps";

const router=Router();
router.post("/demo",async(req,res)=>{
  const uid=userId(req);
  const result=await transaction(async client=>{
    // A user-row lock makes repeated or simultaneous clicks idempotent.
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[uid]);
    const existing=await one("SELECT * FROM series WHERE owner_id=$1 AND demo=true",[uid],client);
    if(existing) return existing;
    const series=await one("INSERT INTO series(owner_id,name,description,demo) VALUES($1,'Calgary Builder Nights','A fictional community series for exploring Encore.',true) RETURNING *",[uid],client);
    const now=new Date(),year=now.getUTCFullYear();
    const past=(days:number)=>new Date(now.getTime()-days*86400000).toISOString();
    const fall=await insertEvent(series!.id,{name:"Fall Kickoff",starts_at:past(100),description_raw:"A fictional first gathering for local builders.",city:"Calgary",purpose_why:"Bring people together",purpose_audience:"Curious makers",purpose_takeaway:"A new connection",guests_expected:50},null,client);
    const winter=await insertEvent(series!.id,{name:"Winter Jam",starts_at:past(35),description_raw:"A fictional evening of demos and conversation.",city:"Calgary",purpose_why:"Share work in progress",purpose_audience:"Local builders",purpose_takeaway:"Useful feedback",guests_expected:75},fall.id,client);
    const spring=await insertEvent(series!.id,{name:"Spring Mixer",starts_at:new Date(now.getTime()+28*86400000).toISOString(),description_raw:"A friendly fictional evening for builders to meet, share small demos, and leave with a new collaborator.",city:"Calgary",place_text:"The community room (fictional)",purpose_why:"Make it easier to build together",purpose_audience:"New and returning community builders",purpose_takeaway:"One new connection and a next step",guests_expected:80},winter.id,client);
    const lesson="Brief the welcome team early so every new face has someone to talk to.";
    const recap={registered:75,attended:54,what_worked:"Small-group introductions helped people start conversations.",what_didnt:"The welcome team needed an earlier briefing.",top_lesson:lesson,rating_overall:4,rating_venue:4,rating_volunteers:5,
      resources:[{name:"The Lantern Room (fictional)",kind:"venue",note:"Flexible seating and a quiet corner for conversation.",use_again:true},{name:"Paper Moon Supplies (fictional)",kind:"vendor",note:"Reusable signs and name tags.",use_again:true}],items:["Brief the welcome team before doors open","Repeat small-group introductions","Reuse the signs and name tags"]};
    await saveRecapData(fall.id,{...recap,registered:50,attended:32,what_worked:"A relaxed introduction round.",what_didnt:"Signage was hard to find.",top_lesson:"Put clear signs at the entrance.",resources:[],items:["Put signs at the entrance","Repeat the introduction round","Record attendance after the event"]},client);
    await saveRecapData(winter.id,recap,client);
    await client.query("UPDATE events SET status='upcoming',plan_accepted=true,carried_lesson=$1,carried_didnt=$2 WHERE id=$3",[lesson,recap.what_didnt,spring.id]);
    const roleIds:number[]=[];
    for(const [name,instruction,slots] of [
      ["Check-in desk","Welcome guests and help them find their name tags.",2],
      ["Setup and teardown","Set out chairs, signs and supplies; leave the space tidy.",3],
      ["Welcome host","Introduce new faces and help everyone feel included.",2],
      ["Photographer","Capture a few moments after asking permission.",1],
    ]) {
      const role=await one("INSERT INTO roles(event_id,name,instruction,slots_needed,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING id",[spring.id,name,instruction,slots,roleIds.length],client);
      roleIds.push(role!.id);
    }
    const names=["Alex","Jordan","Sam","Priya","Casey","Morgan"],vids:number[]=[];
    const roleIndex=[0,0,1,1,2,3];
    for(const [i,name] of names.entries()) {
      const v=await one("INSERT INTO volunteers(event_id,role_id,name,ask_again,token) VALUES($1,$2,$3,$4,$5) RETURNING id",[spring.id,roleIds[roleIndex[i]],name,i<4,randomBytes(24).toString("hex")],client);
      vids.push(v!.id);
    }
    const tasks=[
      {title:"Confirm the room layout",status:"done",group:"Venue and logistics",source:"manual",owner:uid,recurring:true},
      {title:"Write the event description",status:"done",group:"Promotion",source:"ai_plan",owner:uid},
      {title:"Prepare welcome signs and name tags",status:"doing",group:"Venue and logistics",source:"manual",volunteer:vids[2],recurring:true},
      {title:"Share the invitation with the community",status:"doing",group:"Promotion",source:"manual",owner:uid},
      {title:"Alex — Check-in desk",status:"todo",group:"Volunteers",source:"signup",volunteer:vids[0]},
      {title:"Jordan — Check-in desk",status:"todo",group:"Volunteers",source:"signup",volunteer:vids[1]},
      {title:"Brief the welcome team before doors open",status:"todo",group:"Volunteers",source:"ai_plan",source_note:lesson,volunteer:vids[4],recurring:true},
      {title:"Plan a relaxed introduction round",status:"todo",group:"Event day",source:"manual"},
    ];
    for(const [i,t] of tasks.entries()) await client.query(`INSERT INTO tasks(event_id,title,status,group_name,source,source_note,assignee_user_id,assignee_volunteer_id,recurring,sort_order,due_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,($11::timestamptz AT TIME ZONE 'America/Edmonton')::date-2)`,[
      spring.id,t.title,t.status,t.group,t.source,t.source_note||"",t.owner??null,t.volunteer??null,t.recurring??false,i,spring.starts_at]);
    return series;
  });
  res.json(result);
});
export default router;
