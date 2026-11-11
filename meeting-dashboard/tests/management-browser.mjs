import assert from 'node:assert/strict';
import { eventSettings } from '../lib/event-settings.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Europe/Berlin' });
 const errors=[], writes=[]; page.on('pageerror',e=>errors.push(e.message));
 const day=new Date(Date.now()+4*86400000); day.setUTCHours(12,0,0,0); const start=day.toISOString(),end=new Date(+day+1800000).toISOString();
 const events=[{id:42,title:'Project conversation',duration:30,description:'Time to exchange ideas.',scheduleId:7,formats:[{id:'integration:cal-video',label:'Cal Video',input:null}]}];
 const schedules=[{id:7,name:'Working hours',timeZone:'Europe/Berlin',isDefault:true,availability:[{days:['Monday','Tuesday','Wednesday','Thursday','Friday'],startTime:'09:00',endTime:'17:00'}],overrides:[]}];
 let bookings=[{reference:'booking-1',meetingUrl:'https://meet.google.com/test-meeting-link',format:'Google Meet',title:'Project conversation with Alex',start,end,status:'accepted',eventTypeId:42,participants:['Alex','Travis Ruiz'],cancellationReason:''}], uncertain=false, checked=false;
 await page.route('**/api/**',async route=>{
  const request=route.request(),u=new URL(request.url()),path=u.pathname.replace('/api/public/',''),method=request.method();let status=200,data;
  if(method!=='GET') writes.push({path,method,body:request.postDataJSON(),id:request.headers()['idempotency-key']});
  if(path==='config') data={ready:true,organizerEmail:'hello@truemarch.fun',events};
  else if(path==='formats') data={formats:[{id:'integration:cal-video',label:'Cal Video',available:true},{id:'integration:google-meet',label:'Google Meet',available:false},{id:'link',label:'Other video / meeting link',available:true}]};
  else if(path==='schedules'&&method==='GET') data={schedules};
  else if(path==='schedules') {const b=request.postDataJSON();const s={id:8,name:b.name,timeZone:b.timeZone,isDefault:false,availability:[{days:b.days,startTime:b.startTime,endTime:b.endTime}],overrides:b.overrides};schedules.push(s);data={schedule:s};}
  else if(path==='event-types'&&method==='POST'){if(uncertain){status=409;data={uncertain:true,error:'Unknown result'};}else{const b=request.postDataJSON();const e={...b,id:43,formats:[{id:b.formatId,label:'Cal Video',input:null}]};events.push(e);data={event:e};}}
  else if(path==='event-types/43'){if(method!=='GET'){const body=request.postDataJSON();const settings={...events[1].settings,...body.settings};Object.assign(events[1],body,{settings});}data={event:{...events[1],settings:{...eventSettings(),...events[1].settings}}};}
  else if(path==='bookings') data={bookings:bookings.filter(b=>u.searchParams.get('status')==='cancelled'?b.status==='cancelled':b.status==='accepted'),nextCursor:null};
  else if(path==='bookings/booking-1/cancel'){bookings[0].status='cancelled';bookings[0].cancellationReason=request.postDataJSON().reason;data={booking:bookings[0]};}
  else if(path==='bookings/booking-1/reschedule'){bookings[0].start=request.postDataJSON().start;data={booking:bookings[0]};}
  else if(path==='slots') data={slots:[start]};
  else if(path==='receipt'){status=checked?200:409;data=checked?{event:events[0]}:{uncertain:true,error:'Still checking'};}
  else {status=404;data={error:'Unexpected route '+path};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:5173');await page.getByLabel('Your name').waitFor();
 await page.getByRole('button',{name:'Availability',exact:true}).click();await page.getByRole('heading',{name:'Working hours'}).waitFor();
 await page.getByRole('button',{name:'New schedule',exact:true}).click();
 await page.getByLabel('Schedule name',{exact:true}).fill('Afternoon sessions');await page.getByLabel('Start time',{exact:true}).fill('13:00');
 await page.getByRole('button',{name:'Add date override'}).click();await page.getByLabel('Override date 1').fill('2027-01-05');
 await page.getByRole('button',{name:'Create schedule',exact:true}).click();await page.getByRole('heading',{name:'Afternoon sessions',exact:true}).waitFor();
 assert.equal(writes[0].body.startTime,'13:00');assert.ok(writes[0].id);
 await page.getByRole('button',{name:'Events',exact:true}).click();await page.getByRole('button',{name:'New event',exact:true}).click();
 await page.getByLabel('Event title',{exact:true}).fill('Design review');await page.getByLabel('Availability schedule',{exact:true}).selectOption('8');
 assert.equal(await page.getByRole('button',{name:'Create event',exact:true}).isDisabled(),true);
 await page.getByLabel('Event meeting format',{exact:true}).selectOption('integration:cal-video');
 await page.getByRole('button',{name:'Create event',exact:true}).click();await page.getByRole('heading',{name:'Design review',exact:true}).waitFor();
 assert.equal(writes[1].body.settings.minimumBookingNotice,120);assert.equal(writes[1].body.settings.slotInterval,null);assert.equal(writes[1].body.slug,'design-review');assert.equal(writes[1].body.scheduleId,8);assert.equal(writes[1].body.formatId,'integration:cal-video');
 await page.locator('article').filter({has:page.getByRole('heading',{name:'Design review',exact:true})}).getByRole('button',{name:'Edit event'}).click();
 await page.getByLabel('Duration (minutes)').fill('45');
 assert.equal(await page.getByLabel('Minimum notice',{exact:true}).inputValue(),'2');
 await page.getByLabel('Minimum notice',{exact:true}).fill('0');
 await page.getByLabel('Before event (minutes)',{exact:true}).fill('15');
 await page.getByLabel('Time-slot intervals',{exact:true}).selectOption('custom');await page.getByLabel('Slot interval (minutes)').fill('15');
 await page.getByRole('switch',{name:'Limit booking frequency',exact:true}).check();await page.getByLabel('Bookings per day',{exact:true}).fill('4');
 await page.getByRole('switch',{name:'Limit total booking duration',exact:true}).check();await page.getByLabel('Minutes per day',{exact:true}).fill('120');
 await page.getByRole('switch',{name:'Limit future bookings',exact:true}).check();
 await page.getByRole('switch',{name:'Limit upcoming bookings per person',exact:true}).check();
 await page.getByLabel('Maximum upcoming bookings').fill('2');
 await page.locator('.event-settings').screenshot({path:'/tmp/meetingschedule-event-settings-dark.png'});
 for(const width of [390,768,1024]) {await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'event settings overflow at '+width);if(width===390)await page.locator('.event-settings').screenshot({path:'/tmp/meetingschedule-event-settings-mobile.png'});}
 await page.locator('.event-settings').screenshot({path:'/tmp/meetingschedule-event-settings-tablet.png'});
 await page.setViewportSize({width:1440,height:1100});
 await page.getByRole('button',{name:'Save event',exact:true}).click();await page.getByText('45 minutes · Cal.com event').waitFor();
 assert.equal(writes[2].body.settings.minimumBookingNotice,0);assert.equal(writes[2].body.settings.bookingLimitsCount.day,4);assert.equal(Object.hasOwn(writes[2].body.settings,'offsetStart'),false);
 await page.locator('article').filter({has:page.getByRole('heading',{name:'Design review',exact:true})}).getByRole('button',{name:'Edit event'}).click();
 await page.getByLabel('Minimum notice',{exact:true}).waitFor();assert.equal(await page.getByLabel('Minimum notice',{exact:true}).inputValue(),'0');assert.equal(await page.getByLabel('Bookings per day',{exact:true}).inputValue(),'4');
 await page.getByRole('switch',{name:'Limit booking frequency',exact:true}).uncheck();
 await page.getByLabel('Time-slot intervals',{exact:true}).selectOption('default');
 await page.getByRole('button',{name:'Save event',exact:true}).click();await page.getByText('45 minutes · Cal.com event').waitFor();
 assert.deepEqual(writes[3].body.settings,{bookingLimitsCount:{disabled:true},slotInterval:null});

 await page.getByRole('button',{name:'Bookings',exact:true}).click();await page.getByRole('heading',{name:'Project conversation with Alex'}).waitFor();
 const meetingLink=page.getByRole('link',{name:'Open meeting for Project conversation with Alex',exact:true});assert.equal(await meetingLink.getAttribute('href'),'https://meet.google.com/test-meeting-link');assert.equal(await meetingLink.getAttribute('target'),'_blank');assert.match(await meetingLink.getAttribute('rel'),/noopener/);
 assert.match(await page.locator('.workspace-booking .meeting-timezone').textContent(),/Europe\/Berlin · UTC/);
 await page.getByLabel('Display time zone').selectOption('Asia/Tokyo');assert.match(await page.locator('.workspace-booking .meeting-timezone').textContent(),/UTC\+09:00/);
 await page.getByRole('button',{name:'Reschedule',exact:true}).click();await page.getByLabel('New date').fill(start.slice(0,10));await page.getByRole('button',{name:'Find new times'}).click();await page.locator('.workspace-editor .slots button').first().click();
 await page.locator('.workspace-editor input[type="checkbox"]').check();await page.getByRole('button',{name:'Confirm new time'}).click();await page.getByRole('button',{name:'Reschedule',exact:true}).waitFor();
 assert.equal(writes.at(-1).path,'bookings/booking-1/reschedule');
 await page.getByRole('button',{name:'Cancel meeting',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Confirm cancellation',exact:true}).isDisabled(),true);
 await page.getByLabel('Cancellation reason',{exact:true}).fill('Participants requested a different day');await page.locator('.workspace-editor input[type="checkbox"]').check();
 await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();await page.getByRole('heading',{name:'No upcoming meetings'}).waitFor();
 await page.getByRole('button',{name:'Cancelled',exact:true}).click();await page.getByText('Cancellation reason: Participants requested a different day').waitFor();
 assert.equal(await page.getByRole('button',{name:'Cancel meeting',exact:true}).count(),0);
 await page.screenshot({path:'/tmp/meetingschedule-management-dark.png',fullPage:true});
 for(const width of [390,768,1024]){await page.setViewportSize({width,height:1000});if (!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))) { await page.screenshot({path:'/tmp/meetingschedule-sidebar-overflow.png',fullPage:true}); console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})).slice(0,15))); } assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow at '+width);if(width===390)await page.screenshot({path:'/tmp/meetingschedule-management-mobile.png',fullPage:true});}
 await page.getByRole('button',{name:'Switch to light mode'}).click();await page.screenshot({path:'/tmp/meetingschedule-management-light.png',fullPage:true});
 await page.getByRole('button',{name:'Events',exact:true}).click();await page.getByRole('button',{name:'New event',exact:true}).click();await page.getByLabel('Event title',{exact:true}).fill('Uncertain event');await page.getByLabel('Event meeting format',{exact:true}).selectOption('integration:cal-video');uncertain=true;
 await page.getByRole('button',{name:'Create event',exact:true}).click();await page.getByRole('button',{name:'Check change status'}).waitFor();const count=writes.length;
 await page.reload();await page.getByRole('button',{name:'Events',exact:true}).click();await page.getByRole('button',{name:'Check change status'}).waitFor();assert.equal(writes.length,count);
 checked=true;await page.getByRole('button',{name:'Check change status'}).click();await page.getByText('Change confirmed.').waitFor();assert.equal(await page.evaluate(()=>sessionStorage.getItem('meetingschedule-pending-management')),null);
 assert.deepEqual(errors,[]);assert.ok(writes.every(w=>w.id));
 console.log('Shared management browser checks passed: create/edit events, availability, reschedule, cancellation list, time zones, themes, responsive layout and uncertain-write recovery. No real emails sent.');
}finally{await browser.close();}
