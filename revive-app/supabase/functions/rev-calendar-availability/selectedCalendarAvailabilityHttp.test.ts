import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCalendarAvailability, type CalendarAvailabilityDependencies } from './calendarAvailabilityBoundary.ts';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const payload={workspaceId:ws,searchStartAt:'2040-09-30T09:00:00.000Z',searchEndAt:'2040-09-30T17:00:00.000Z',timezone:'Europe/London',requestedDurationMinutes:30};
const req=(body:unknown=payload)=>new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer fake','Content-Type':'application/json'},body:JSON.stringify(body)});
const trusted={selectedCalendar:{id:'33333333-3333-4333-8333-333333333333',workspaceId:ws,connectionId:'44444444-4444-4444-8444-444444444444',provider:'microsoft_graph' as const,providerCalendarReference:'selected-id',timezone:'Europe/London'},policy:{minimumNoticeMinutes:0,beforeBufferMinutes:0,afterBufferMinutes:0,availabilityWindows:[{startAt:payload.searchStartAt,endAt:payload.searchEndAt}]}};
function fixture(){
 const calls:string[]=[];
 const deps:CalendarAvailabilityDependencies={getAuthenticatedUserId:async()=>actor,hasActiveWorkspaceMembership:async()=>true,isCalendarAvailabilityEnabled:()=>true,
  resolveTrustedCalendarAvailability:async()=>{calls.push('pilot');throw new Error('pilot must remain unused');},
  resolveSelectedCalendarAvailability:async(w,s,e,t,u)=>{calls.push('selected');assert.equal(w,ws);assert.equal(u,actor);assert.equal(s,payload.searchStartAt);assert.equal(e,payload.searchEndAt);assert.equal(t,payload.timezone);return{...trusted,busyIntervals:[]};},
  readBusyIntervals:async()=>{calls.push('legacyGraph');throw new Error('unused');},
  calculateAvailability:(()=>({status:'available',slots:[],timezone:'Europe/London'})) as never,now:()=> '2040-09-01T00:00:00.000Z'};
 return{calls,deps};
}
test('selected HTTP path forwards verified actor and bypasses pilot credentials and Graph reader',async()=>{
 const f=fixture();const response=await handleCalendarAvailability(req(),f.deps);assert.equal(response.status,200);assert.deepEqual(f.calls,['selected']);const body=await response.json();assert.deepEqual(body.slots,[]);assert.ok(!JSON.stringify(body).includes('accessToken'));
});
test('disabled gate, failed auth, denied membership and injected actor stop before selected lookup',async()=>{
 for(const mode of ['disabled','auth','membership','injected']){const f=fixture();if(mode==='disabled')f.deps.isCalendarAvailabilityEnabled=()=>false;if(mode==='auth')f.deps.getAuthenticatedUserId=async()=>null;if(mode==='membership')f.deps.hasActiveWorkspaceMembership=async()=>false;const response=await handleCalendarAvailability(req(mode==='injected'?{...payload,userId:actor}:payload),f.deps);assert.ok(response.status>=400);assert.deepEqual(f.calls,[]);}
});
test('selected failure never falls back to pilot',async()=>{
 const f=fixture();f.deps.resolveSelectedCalendarAvailability=async()=>{f.calls.push('selected');throw new Error('refused');};const response=await handleCalendarAvailability(req(),f.deps);assert.equal(response.status,503);assert.deepEqual(f.calls,['selected']);
});
test('unset selected hook retains original pilot path',async()=>{
 const f=fixture();delete f.deps.resolveSelectedCalendarAvailability;f.deps.resolveTrustedCalendarAvailability=async()=>{f.calls.push('pilot');return{...trusted,accessToken:'fake-pilot',primaryMailboxUserPrincipalName:'fake@example.test'};};f.deps.readBusyIntervals=async()=>{f.calls.push('legacyGraph');return[];};assert.equal((await handleCalendarAvailability(req(),f.deps)).status,200);assert.deepEqual(f.calls,['pilot','legacyGraph']);
});
