import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
const base = "http://localhost:80/api";
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
const users = [];
export class Client {
  cookies = new Map();
  csrf = "";
  async call(path, method="GET", data, expected=200) {
    const response = await fetch(base+path,{method,headers:{"Content-Type":"application/json",Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join("; "),"x-csrf-token":this.csrf},body:data===undefined?undefined:JSON.stringify(data)});
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";"); const i=pair.indexOf("="); this.cookies.set(pair.slice(0,i),pair.slice(i+1));
    }
    const json = await response.json();
    assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(json)}`);
    if (json.csrfToken) this.csrf=json.csrfToken;
    return json;
  }
}
const password = randomBytes(18).toString("hex");
const suffix = randomBytes(8).toString("hex");
const phase = Number(process.argv[2] || 0);
try {
  const a = new Client(), b=new Client();
  if(phase>=1) await a.call("/series","GET",undefined,401);
  await a.call("/auth/me");
  const email=`selftest-${suffix}@example.invalid`;
  const signed = await a.call("/auth/signup","POST",{name:"Fictional Tester",email,password});
  users.push(signed.user.id);
  assert.equal((await a.call("/auth/me")).user.id,signed.user.id);
  await a.call("/auth/logout","POST");
  assert.equal((await a.call("/auth/me")).user,null);
  await a.call("/auth/login","POST",{email,password:"incorrect-password"},401);
  await a.call("/auth/login","POST",{email,password});
  const savedCsrf = a.csrf; a.csrf="invalid";
  await a.call("/auth/logout","POST",undefined,403); a.csrf=savedCsrf;
  await b.call("/auth/me");
  const other=await b.call("/auth/signup","POST",{name:"Other Fictional Tester",email:`second-${suffix}@example.invalid`,password});
  users.push(other.user.id);
  const secretRows=await pool.query("SELECT password_hash FROM users WHERE id=$1",[signed.user.id]);
  assert.notEqual(secretRows.rows[0].password_hash,password);
  console.log("PASS Phase 0: signup, logout, login, wrong password, hashed storage, CSRF and independent sessions");
  if (phase >= 1) {
    const series=await a.call("/series","POST",{name:"Fictional Self-test Series",description:"Test fixtures only"});
    assert.equal((await b.call("/series")).length,0);
    await b.call(`/series/${series.id}/dashboard`,"GET",undefined,404);
    await a.call(`/series/${series.id}/events`,"POST",{name:"",starts_at:"bad",description_raw:""},400);
    const event=await a.call(`/series/${series.id}/events`,"POST",{
      name:"Fictional Spring Test",starts_at:"2027-03-20T01:00:00Z",timezone:"America/Edmonton",city:"Calgary",
      description_raw:"A fictional gathering for local makers.",purpose_why:"Meet others",purpose_audience:"New builders",purpose_takeaway:"One new friend",guests_expected:60,budget_amount:0
    });
    await b.call(`/events/${event.id}`,"GET",undefined,404);
    await b.call(`/events/${event.id}`,"PATCH",{status:"done"},404);
    const editedEvent = await a.call(`/events/${event.id}`,"PATCH",{
      name:"Fictional Spring Test — edited",starts_at:"2027-03-21T00:30:00Z",
      city:"Edmonton",place_text:"Fictional room",guests_expected:75,budget_amount:125.50,
      description_raw:"Updated fictional gathering.",purpose_why:"Meet others",purpose_audience:"New builders",purpose_takeaway:"Two new friends"
    });
    assert.equal(editedEvent.name,"Fictional Spring Test — edited");
    assert.equal(editedEvent.guests_expected,75);
    assert.equal(editedEvent.budget_amount,125.50);
    assert.equal(editedEvent.signup_slug,event.signup_slug);
    assert(editedEvent.updated_at);
    assert.equal(editedEvent.updated_by_name,"Fictional Tester");
    await a.call(`/events/${event.id}`,"PATCH",{name:"   "},400);
    await a.call(`/events/${event.id}`,"PATCH",{starts_at:"not a date"},400);
    await a.call(`/events/${event.id}`,"PATCH",{timezone:"Not/AZone"},400);
    await a.call(`/events/${event.id}`,"PATCH",{guests_expected:-1},400);
    const freshEvent=(await a.call(`/events/${event.id}`)).event;
    assert.equal(freshEvent.city,"Edmonton");
    assert.equal(freshEvent.purpose_takeaway,"Two new friends");
    const plan=await a.call("/ai/plan","POST",{event_id:event.id});
    assert.match(plan.notice,/template/);
    const before=await a.call(`/events/${event.id}`); assert.equal(before.tasks.length,0); assert.equal(before.event.purpose_why,"Meet others");
    plan.groups[0].tasks[0].title="An edited fictional task"; plan.groups[0].tasks.splice(1,1);
    await a.call(`/events/${event.id}/accept-plan`,"POST",plan);
    const accepted=await a.call(`/events/${event.id}`);
    assert(accepted.tasks.some(t=>t.title==="An edited fictional task"));
    assert.equal(accepted.tasks.length,16); assert.equal(accepted.roles.length,4);
    await a.call(`/events/${event.id}/accept-plan`,"POST",plan);
    assert.equal((await a.call(`/events/${event.id}`)).tasks.length,16);
    const dash=await a.call(`/series/${series.id}/dashboard`); assert.equal(dash.events[0].tasks_total,16);
    await a.call(`/events/${event.id}/plan-suggestions`,"POST",{groups:[{name:"Fictional additions",tasks:[{title:"Suggested task kept separate",due_offset_days:2}]}],roles:[],notice:"Template"});
    const suggested=await a.call(`/events/${event.id}`);
    assert(suggested.tasks.some(t=>t.title==="Suggested task kept separate"));
    assert.equal(suggested.tasks.length,17);
    const finished=accepted.tasks.find(t=>t.due_date),openTask=accepted.tasks.find(t=>t.id!==finished.id&&t.status!=="done"&&t.due_date);
    await a.call(`/events/${event.id}/tasks/${finished.id}`,"PATCH",{status:"done"});
    const finishedDate=finished.due_date,openDate=openTask.due_date;
    const shiftedEvent=await a.call(`/events/${event.id}`,"PATCH",{starts_at:"2027-03-22T00:30:00Z",move_task_due_dates:true});
    const afterShift=await a.call(`/events/${event.id}`);
    assert.equal(afterShift.tasks.find(t=>t.id===finished.id).due_date,finishedDate);
    assert.equal(afterShift.tasks.find(t=>t.id===openTask.id).due_date,new Date(Date.parse(`${openDate}T12:00:00Z`)+86400000).toISOString().slice(0,10));
    assert.equal(shiftedEvent.updated_by_name,"Fictional Tester");
    const beforeNoShift=afterShift.tasks.find(t=>t.id===openTask.id).due_date;
    await a.call(`/events/${event.id}`,"PATCH",{starts_at:"2027-03-23T00:30:00Z"});
    assert.equal((await a.call(`/events/${event.id}`)).tasks.find(t=>t.id===openTask.id).due_date,beforeNoShift);
    assert.equal((await a.call("/auth/me")).ai_remaining,150);
    console.log("PASS Phase 1: series isolation, event editing/audit metadata, accepted-plan suggestions, opt-in unfinished-task due-date shifts, editable fallback plan, idempotent acceptance, no paid AI calls");
    if (phase >= 2) {
      const publicClient=new Client();
      const role=await a.call(`/events/${event.id}/roles`,"POST",{name:"Fictional single slot",instruction:"Help with this test",slots_needed:1});
      const page=await publicClient.call(`/public/join/${event.signup_slug}`);
      assert.equal(page.roles.find(r=>r.id===role.id).filled,0);
      const signup={name:"Fictional Alex",role_id:role.id,email:"unused@example.invalid",email_consent:false,ask_again:true,website:""};
      await publicClient.call(`/public/join/${event.signup_slug}`,"POST",{...signup,website:"bot"},400);
      const concurrent=await Promise.allSettled([
        publicClient.call(`/public/join/${event.signup_slug}`,"POST",signup),
        publicClient.call(`/public/join/${event.signup_slug}`,"POST",{...signup,name:"Fictional Jordan"}),
      ]);
      assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1);
      const joined=concurrent.find(r=>r.status==="fulfilled").value;
      assert(joined.token.length>=32);
      const privatePage=await publicClient.call(`/public/v/${joined.token}`);
      assert.equal(privatePage.tasks.length,1); assert(!("email" in privatePage));
      const live=await a.call(`/events/${event.id}`);
      const volunteer=live.volunteers[0]; assert.equal(volunteer.email,null);
      const emptyMap=await a.call(`/events/${event.id}/map`);
      assert.equal(emptyMap.map,null); assert.equal(emptyMap.items.length,0); assert.equal(emptyMap.map_shared,false);
      await b.call(`/events/${event.id}/map`,"GET",undefined,404);
      await a.call(`/events/${event.id}/map/upload-url`,"POST",{name:"bad.gif",size:25,contentType:"image/gif"},400);
      const blankMap=await a.call(`/events/${event.id}/map`,"PUT",{source:"blank"});
      assert.equal(blankMap.map.source,"blank");
      const booth=await a.call(`/events/${event.id}/map/items`,"POST",{
        kind:"booth",label:"Booth 1",x_pct:5,y_pct:8,w_pct:12,h_pct:10,vendor_name:"Temporary vendor",needs_text:"Power"
      });
      await a.call(`/events/${event.id}/map/items`,"POST",{
        kind:"booth",label:"Outside",x_pct:95,y_pct:8,w_pct:10,h_pct:10
      },400);
      const station=await a.call(`/events/${event.id}/map/items`,"POST",{
        kind:"station",label:"Check-in",x_pct:40,y_pct:30,w_pct:12,h_pct:8,role_id:role.id
      });
      await a.call(`/events/${event.id}/map/items`,"POST",{
        kind:"station",label:"Wrong event role",x_pct:40,y_pct:30,w_pct:12,h_pct:8,role_id:999999
      },404);
      const editedBooth=await a.call(`/events/${event.id}/map/items/${booth.id}`,"PATCH",{label:"Booth One",vendor_name:"Updated fictional vendor"});
      assert.equal(editedBooth.label,"Booth One");
      const removable=await a.call(`/events/${event.id}/map/items`,"POST",{
        kind:"zone",label:"Temporary zone",x_pct:70,y_pct:20,w_pct:8,h_pct:10
      });
      await a.call(`/events/${event.id}/map/items/${removable.id}`,"DELETE");
      await a.call(`/events/${event.id}/map-sharing`,"PATCH",{map_shared:true});
      const volunteerMap=await publicClient.call(`/public/v/${joined.token}/map`);
      assert.equal(volunteerMap.available,true);
      assert.equal(volunteerMap.own_station_id,station.id);
      assert.equal(volunteerMap.map.source,"blank");
      assert.equal(volunteerMap.items.length,2);
      assert.equal((await publicClient.call(`/public/v/${joined.token}`)).has_map_post,true);
      await a.call(`/events/${event.id}/map-sharing`,"PATCH",{map_shared:false});
      assert.equal((await publicClient.call(`/public/v/${joined.token}/map`)).available,false);
      assert.equal((await publicClient.call(`/public/v/${joined.token}`)).has_map_post,false);
      const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qioAAAAASUVORK5CYII=","base64");
      const upload=await a.call(`/events/${event.id}/map/upload-url`,"POST",{name:"fictional-floor-plan.png",size:png.length,contentType:"image/png"});
      const put=await fetch(upload.uploadURL,{method:"PUT",headers:{"Content-Type":"image/png"},body:png});
      assert.equal(put.ok,true,`Direct map upload failed: ${put.status}`);
      const uploadedMap=await a.call(`/events/${event.id}/map`,"PUT",{source:"upload",objectPath:upload.objectPath,image_width:1,image_height:1});
      assert.equal(uploadedMap.map.source,"upload"); assert.equal(uploadedMap.map.image_width,1); assert.equal(uploadedMap.map.image_name,"fictional-floor-plan.png");
      const cookie=[...a.cookies].map(([name,value])=>`${name}=${value}`).join("; ");
      const organizerImage=await fetch(`${base}/events/${event.id}/map/image`,{headers:{Cookie:cookie}});
      assert.equal(organizerImage.status,200); assert.equal(organizerImage.headers.get("content-type"),"image/png");
      assert.deepEqual(Buffer.from(await organizerImage.arrayBuffer()),png);
      await b.call(`/events/${event.id}/map/image`,"GET",undefined,404);
      await a.call(`/events/${event.id}/map-sharing`,"PATCH",{map_shared:true});
      const volunteerImage=await fetch(`${base}/public/v/${joined.token}/map/image`);
      assert.equal(volunteerImage.status,200); assert.deepEqual(Buffer.from(await volunteerImage.arrayBuffer()),png);
      await a.call(`/events/${event.id}/map-sharing`,"PATCH",{map_shared:false});
      assert.equal((await fetch(`${base}/public/v/${joined.token}/map/image`)).status,404);
      const blankAgain=await a.call(`/events/${event.id}/map`,"PUT",{source:"blank"});
      assert.equal(blankAgain.map.source,"blank"); assert.equal(blankAgain.map.image_url,null); assert.equal(blankAgain.items.length,2);
      const safeguardedRole=await a.call(`/events/${event.id}/roles`,"POST",{name:"Fictional capacity safeguard",instruction:"Capacity test",slots_needed:3});
      const capacityOne=await publicClient.call(`/public/join/${event.signup_slug}`,"POST",{name:"Fictional Morgan",role_id:safeguardedRole.id,email_consent:false,ask_again:false});
      const capacityTwo=await publicClient.call(`/public/join/${event.signup_slug}`,"POST",{name:"Fictional Casey",role_id:safeguardedRole.id,email_consent:false,ask_again:false});
      await a.call(`/events/${event.id}/roles/${safeguardedRole.id}`,"PATCH",{name:safeguardedRole.name,instruction:safeguardedRole.instruction,slots_needed:1},400);
      await a.call(`/events/${event.id}/roles/${safeguardedRole.id}`,"DELETE",undefined,409);
      const capacityOneId=(await pool.query("SELECT id FROM volunteers WHERE token=$1",[capacityOne.token])).rows[0].id;
      const capacityTwoId=(await pool.query("SELECT id FROM volunteers WHERE token=$1",[capacityTwo.token])).rows[0].id;
      await a.call(`/events/${event.id}/volunteers/${capacityOneId}`,"DELETE");
      await a.call(`/events/${event.id}/volunteers/${capacityTwoId}`,"DELETE");
      await a.call(`/events/${event.id}/roles/${safeguardedRole.id}`,"DELETE");
      assert.equal(live.tasks.filter(t=>t.source==="signup").length,1);
      const ownTask=privatePage.tasks[0];
      await publicClient.call(`/public/v/${joined.token}/tasks/${ownTask.id}`,"PATCH",{done:true});
      assert.equal((await a.call(`/events/${event.id}`)).tasks.find(t=>t.id===ownTask.id).status,"done");
      await publicClient.call(`/public/v/${joined.token}/tasks/${accepted.tasks[0].id}`,"PATCH",{done:true},404);
      const teamTask=await a.call(`/events/${event.id}/tasks`,"POST",{title:"Fictional role checklist task",role_id:role.id});
      assert((await publicClient.call(`/public/v/${joined.token}`)).tasks.some(t=>t.id===teamTask.id));
      await publicClient.call(`/public/v/${joined.token}/tasks/${teamTask.id}`,"PATCH",{done:true});
      const t=await a.call(`/events/${event.id}/tasks`,"POST",{title:"Fictional editable task",status:"todo",due_date:"2027-03-17",recurring:true,assignee_user_id:signed.user.id});
      assert.equal(t.due_date,"2027-03-17");
      for(const status of ["doing","done","todo"]) {
        const moved=await a.call(`/events/${event.id}/tasks/${t.id}`,"PATCH",{status,sort_order:2.5});
        assert.equal(moved.status,status);
        assert.equal(moved.due_date,"2027-03-17");
      }
      await a.call(`/events/${event.id}/tasks/${t.id}`,"PATCH",{due_date:"2027-02-30"},400);
      await a.call(`/events/${event.id}/tasks/${t.id}`,"PATCH",{due_date:"2027-13-01"},400);
      assert.equal((await a.call(`/events/${event.id}/tasks/${t.id}`,"PATCH",{due_date:"2028-02-29"})).due_date,"2028-02-29");
      await a.call(`/events/${event.id}/tasks/${t.id}`,"PATCH",{due_date:null});
      assert.equal((await a.call(`/events/${event.id}`)).tasks.find(x=>x.id===t.id).due_date,null);
      await a.call(`/events/${event.id}/tasks/${t.id}`,"PATCH",{due_date:"2027-03-17"});
      await a.call(`/events/${event.id}/tasks/${t.id}`,"PATCH",{assignee_user_id:null,assignee_volunteer_id:volunteer.id});
      assert((await publicClient.call(`/public/v/${joined.token}`)).tasks.some(x=>x.id===t.id));
      await b.call(`/events/${event.id}/tasks/${t.id}`,"PATCH",{status:"done"},404);
      await a.call(`/events/${event.id}`,"PATCH",{event_day_mode:true,event_day_notes:"Arrive early",day_of_contact_text:"Find the organizer at check-in"});
      assert.equal((await publicClient.call(`/public/v/${joined.token}`)).event_day,true);
      await a.call(`/events/${event.id}`,"PATCH",{signups_open:false});
      await publicClient.call(`/public/join/${event.signup_slug}`,"POST",signup,409);
      await a.call(`/events/${event.id}`,"PATCH",{signups_open:true});
      const helper=await a.call("/ai/helper","POST",{event_id:event.id,question:"What should I do next?"});
      assert(helper.actions.length<=4); assert.match(helper.notice,/template/);
      await a.call(`/events/${event.id}/volunteers/${volunteer.id}`,"DELETE");
      assert.equal((await a.call(`/events/${event.id}`)).tasks.filter(t=>t.source==="signup").length,0);
      assert.equal((await publicClient.call(`/public/join/${event.signup_slug}`)).roles.find(r=>r.id===role.id).filled,0);
      await publicClient.call(`/public/v/${joined.token}`,"GET",undefined,404);
      await a.call(`/events/${event.id}/tasks/${t.id}`,"DELETE");
      await a.call(`/events/${event.id}/roles/${role.id}`,"DELETE");
      console.log("PASS Phase 2: task/role CRUD, drag endpoints and assignment, slot reduction/deletion safeguards, atomic signup capacity, public/private scopes, event-day ticks and helper drafts");
      if (phase >= 3) {
        const role2=await a.call(`/events/${event.id}/roles`,"POST",{name:"Fictional returning role",instruction:"Welcome people",slots_needed:5});
        const willing=await publicClient.call(`/public/join/${event.signup_slug}`,"POST",{name:"Fictional Priya",role_id:role2.id,email:"consented@example.invalid",email_consent:true,ask_again:true});
        await publicClient.call(`/public/join/${event.signup_slug}`,"POST",{name:"Fictional Sam",role_id:role2.id,email_consent:false,ask_again:false});
        const recurring=await a.call(`/events/${event.id}/tasks`,"POST",{title:"Repeat this fictional task",recurring:true,assignee_user_id:signed.user.id,due_date:"2027-03-18"});
        const recap={registered:80,attended:60,what_worked:"Small groups",what_didnt:"Late briefing",top_lesson:"Brief the team earlier",rating_overall:4,rating_venue:3,rating_volunteers:5,resources:[
          {name:"Fictional room",kind:"venue",note:"Bright and flexible",use_again:true},
          {name:"Do not reuse this fictional vendor",kind:"vendor",note:"Not a fit",use_again:false},
          {name:"Fictional map vendor",kind:"vendor",note:"Use again",use_again:true}
        ],items:["Brief the team earlier","Repeat small groups","Reuse the fictional room"]};
        await a.call(`/events/${event.id}/recap`,"PUT",recap);
        await a.call(`/events/${event.id}/map/items`,"POST",{
          kind:"booth",label:"Booth with reusable vendor",x_pct:10,y_pct:50,w_pct:14,h_pct:12,vendor_name:"Fictional map vendor"
        });
        await a.call(`/events/${event.id}/map/items`,"POST",{
          kind:"booth",label:"Booth with nonreusable vendor",x_pct:30,y_pct:50,w_pct:14,h_pct:12,vendor_name:"Do not reuse this fictional vendor"
        });
        const saved=await a.call(`/events/${event.id}`);
        assert.equal(saved.recap.attended/saved.recap.registered,.75); assert.equal(saved.resources.length,3);
        const starter=await a.call("/ai/starter","POST",{event_id:event.id,recap});
        assert(starter.items.length>=3&&starter.items.length<=7); assert.match(starter.notice,/template/);
        await pool.query("INSERT INTO ai_usage(user_id,month,call_count) VALUES($1,$2,150) ON CONFLICT(user_id,month) DO UPDATE SET call_count=150",[signed.user.id,new Date().toISOString().slice(0,7)]);
        const capped=await a.call("/ai/helper","POST",{event_id:event.id,question:"Check the limit"});
        assert.equal(capped.ai_remaining,0); assert.match(capped.notice,/limit is reached/);
        const input={name:"Fictional next event",starts_at:"2027-04-20T01:00:00Z",carry_lessons:true,carry_resources:true,carry_roles:true,carry_recurring:true,carry_volunteers:true,carry_map:true,items:["An edited starter task"]};
        const next=await a.call(`/events/${event.id}/next`,"POST",input);
        const nb=await a.call(`/events/${next.id}`);
        assert.equal(nb.event.previous_event_id,event.id); assert.equal(nb.event.carried_lesson,recap.top_lesson);
        assert.equal(nb.resources.length,2); assert.equal(nb.volunteers.length,1); assert.equal(nb.volunteers[0].name,"Fictional Priya"); assert.equal(nb.volunteers[0].email,"consented@example.invalid");
        const nextMap=await a.call(`/events/${next.id}/map`);
        assert.equal(nextMap.items.length,4);
        assert.equal(nextMap.map.source,"blank");
        assert.equal((await a.call(`/events/${next.id}`)).event.map_shared,false);
        assert.equal(nextMap.items.find(i=>i.label==="Booth with reusable vendor").vendor_name,"Fictional map vendor");
        assert.equal(nextMap.items.find(i=>i.label==="Booth with nonreusable vendor").vendor_name,null);
        assert.notEqual(nb.volunteers[0].token,willing.token);
        assert.equal(nb.roles.length,accepted.roles.length+1);
        assert(nb.tasks.some(t=>t.title==="An edited starter task"&&t.source==="starter"));
        assert(nb.tasks.some(t=>t.title===recurring.title&&t.source==="carryover"));
        assert.equal(nb.event.plan_accepted,false);
        const blank=await a.call(`/events/${event.id}/next`,"POST",{...input,name:"Fictional no carry-over",carry_lessons:false,carry_resources:false,carry_roles:false,carry_recurring:false,carry_volunteers:false,carry_map:false,items:[]});
        const bb=await a.call(`/events/${blank.id}`); assert.equal(bb.resources.length,0); assert.equal(bb.roles.length,0); assert.equal(bb.tasks.length,0); assert.equal(bb.volunteers.length,0); assert.equal(bb.event.carried_lesson,"");
        assert.equal((await a.call(`/events/${blank.id}/map`)).map,null);
        const reminder=await a.call(`/events/${event.id}/reminder`); assert(reminder.drafts.some(d=>d.name==="Fictional Priya"&&d.message.includes("/v/"))); assert(!reminder.message.includes("/v/")); assert.equal(reminder.email_enabled,false);
        await b.call(`/events/${event.id}/recap`,"PUT",recap,404);
        await b.call(`/events/${event.id}/next`,"POST",input,404);
        const demo=await a.call("/demo","POST"); const demo2=await a.call("/demo","POST"); assert.equal(demo.id,demo2.id);
        const dd=await a.call(`/series/${demo.id}/dashboard`); assert.equal(dd.events.length,3); assert.equal(dd.latest.event.name,"Winter Jam"); assert.equal(dd.latest.resources.length,2);
        const spring=dd.events.find(e=>e.name==="Spring Mixer"),sb=await a.call(`/events/${spring.id}`);
        assert.equal(sb.roles.length,4); assert.equal(sb.volunteers.length,6); assert.equal(sb.tasks.length,8); assert.equal(sb.tasks.filter(t=>t.source==="signup").length,2);
        assert(sb.tasks.some(t=>t.source_note&&t.source==="ai_plan"));
        console.log("PASS Phase 3: recap persistence/show-rate, editable starter, selected-only carry-over and consent, fresh private tokens, reminders without email, idempotent fictional demo");
      }
    }
  }
} finally {
  if (users.length) await pool.query("DELETE FROM users WHERE id=ANY($1::int[])",[users]);
  await pool.end();
}
