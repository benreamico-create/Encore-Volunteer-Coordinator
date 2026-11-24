import { Router } from "express";
import { randomBytes } from "node:crypto";
import { userId } from "../lib/security";
import { one, transaction, required } from "../lib/store";
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
router.post("/demo/update",async(req,res)=>{
  const uid=userId(req);
  const series=await transaction(async client=>{
    const demo=required(await one("SELECT * FROM series WHERE owner_id=$1 AND demo=true FOR UPDATE",[uid],client),"Load the demo series before updating it.");
    const done=await one("SELECT series_id FROM demo_updates WHERE series_id=$1",[demo.id],client);
    if(done)return demo;
    await client.query("UPDATE series SET name='Calgary Maker Markets',description='A fictional community market series for exploring Encore.' WHERE id=$1",[demo.id]);
    const spring=required(await one("SELECT * FROM events WHERE series_id=$1 ORDER BY starts_at DESC,id DESC LIMIT 1",[demo.id],client),"The demo event was not found.");
    await client.query(`UPDATE events SET name='Spring Maker Market',
      description_raw='A friendly fictional market bringing local makers and neighbors together.',
      purpose_why='Make it easy for local makers to share their work and meet new customers.',
      purpose_audience='Calgary makers, neighbors and curious visitors.',
      purpose_takeaway='A welcoming market with clear booths, useful volunteer posts and new community connections.',
      status='upcoming',plan_accepted=true,city='Calgary',place_text='Community Hall (fictional)',
      sponsor_goal_amount=2500,updated_at=now() WHERE id=$1`,[spring.id],client);
    const roleRows=await (async()=>{
      const rows=(await client.query("SELECT id FROM roles WHERE event_id=$1 ORDER BY sort_order,id",[spring.id])).rows;
      const specs=[["Setup crew","Set up tables, signs and supplies.",2],["Check-in desk","Welcome visitors near the entrance.",2],["Info table","Help visitors find booths and event details.",2],["Cleanup","Pack down the hall and leave it tidy.",2]];
      for(let i=0;i<specs.length;i++){
        if(rows[i])await client.query("UPDATE roles SET name=$1,instruction=$2,slots_needed=$3,sort_order=$4 WHERE id=$5",[...specs[i],i,rows[i].id]);
        else rows.push((await client.query("INSERT INTO roles(event_id,name,instruction,slots_needed,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING id",[spring.id,...specs[i],i])).rows[0]);
      }
      return rows;
    })();
    const names=["Maple Press","Prairie Pottery","Wildflower Soap","North Star Coffee","Little Fern Studio","Copper Moon Candles","Bright Thread Textiles"];
    const resources=[];
    for(const name of names){
      const old=await one("SELECT id FROM resources WHERE event_id=$1 AND name=$2",[spring.id,name],client);
      resources.push(old?.id??(await one("INSERT INTO resources(event_id,name,kind,note,use_again) VALUES($1,$2,'vendor','Fictional market vendor resource.',true) RETURNING id",[spring.id,name],client))!.id);
    }
    let map=await one("SELECT id FROM maps WHERE event_id=$1",[spring.id],client);
    if(!map)map=await one("INSERT INTO maps(event_id,source) VALUES($1,'blank') RETURNING id",[spring.id],client);
    const mapCount=await one("SELECT count(*)::int AS n FROM map_items WHERE map_id=$1",[map!.id],client);
    if(Number(mapCount?.n)===0){
      const add=async(kind:string,label:string,x:number,y:number,w:number,h:number,extra:Record<string,unknown>={})=>
        client.query("INSERT INTO map_items(map_id,kind,label,x_pct,y_pct,w_pct,h_pct,vendor_name,needs_text,role_id,resource_id,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [map!.id,kind,label,x,y,w,h,extra.vendor_name??null,extra.needs_text??null,extra.role_id??null,extra.resource_id??null,Number(extra.sort_order??0)]);
      await add("zone","Hall outline",3,3,94,94,{sort_order:0});
      for(let i=0;i<8;i++){
        const row=Math.floor(i/4),col=i%4,x=9+col*21,y=18+row*43;
        await add("booth",`Booth ${i+1}`,x,y,15,17,{vendor_name:i<7?names[i]:null,resource_id:i<7?resources[i]:null,sort_order:i+1});
      }
      await add("stage","Stage",40,6,20,8,{sort_order:10});
      await add("zone","Food trucks",76,64,18,24,{needs_text:"Dashed food truck area",sort_order:11});
      await add("entrance","Entrance",41,86,18,8,{sort_order:12});
      await add("station","Check-in",23,80,14,8,{role_id:roleRows[1].id,sort_order:13});
      await add("station","Info table",64,43,14,8,{role_id:roleRows[2].id,sort_order:14});
      await add("station","Loading dock",76,12,16,8,{role_id:roleRows[0].id,sort_order:15});
    }
    const sponsorCount=await one("SELECT count(*)::int AS n FROM sponsors WHERE event_id=$1",[spring.id],client);
    if(Number(sponsorCount?.n)===0){
      const sponsors=[
        ["Prairie Print Co.","Printed market signs and banners.","yes",1500,uid,"Confirm final banner proofs",null],
        ["North Star Coffee","Coffee for the volunteer table.","talking",null,uid,"Confirm serving setup",null],
        ["Bright Thread Studio","A maker workshop contribution.","asked",null,null,"Send the event overview",null],
        ["Copper Leaf Market","Interested in supporting next season.","declined",null,null,"Check back after summer",null],
      ];
      for(const s of sponsors)await client.query("INSERT INTO sponsors(event_id,name,offer_text,status,amount,owner_user_id,next_step_text) VALUES($1,$2,$3,$4,$5,$6,$7)",[spring.id,...s.slice(0,3),s[3],s[4],s[5]]);
    }
    const ann=await one("SELECT id FROM announcements WHERE event_id=$1 LIMIT 1",[spring.id],client);
    if(!ann)await client.query("INSERT INTO announcements(event_id,user_id,body) VALUES($1,$2,$3)",[spring.id,uid,"Welcome to Spring Maker Market! Check the map for booth locations, the entrance, and volunteer posts."]);
    let partner=await one("SELECT id FROM users WHERE demo_owner_id=$1",[uid],client);
    if(!partner)partner=await one("INSERT INTO users(name,email,password_hash,demo_owner_id) VALUES('Avery Morgan',$1,NULL,$2) RETURNING id",[`${uid}.demo-organizer@encore.invalid`,uid],client);
    await client.query("INSERT INTO series_members(series_id,user_id,role) VALUES($1,$2,'editor') ON CONFLICT DO NOTHING",[demo.id,partner!.id]);
    const messageCount=await one("SELECT count(*)::int AS n FROM messages WHERE event_id=$1",[spring.id],client);
    if(Number(messageCount?.n)===0){
      const messages=[
        [uid,"I added the hall layout and the first set of vendor booths."],
        [partner!.id,"I’ll check the volunteer posts near check-in and the loading dock."],
        [uid,"The seven vendor resources are placed; booth eight is open."],
        [partner!.id,"Great. I’ll confirm the coffee setup with North Star before market day."],
      ];
      for(const [userId,body] of messages)await client.query("INSERT INTO messages(event_id,user_id,body) VALUES($1,$2,$3)",[spring.id,userId,body]);
    }
    await client.query("INSERT INTO demo_updates(series_id) VALUES($1)",[demo.id]);
    return {...demo,name:"Calgary Maker Markets",description:"A fictional community market series for exploring Encore.",demo:true};
  });
  res.json(series);
});
export default router;
