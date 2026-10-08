import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectedCalendarAvailabilityService, type SelectedCalendarServiceDependencies } from './selectedCalendarAvailabilityService.ts';
import { handleCalendarAvailability, type CalendarAvailabilityDependencies } from './calendarAvailabilityBoundary.ts';
import { buildBusinessHoursAvailabilityWindows } from './businessHoursPolicy.ts';
const ws='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',calendar='33333333-3333-4333-8333-333333333333',connection='44444444-4444-4444-8444-444444444444',credential='55555555-5555-4555-8555-555555555555';
const query={workspaceId:ws,userId:user,timezone:'Europe/London',searchStartAt:'2040-09-30T09:00:00.000Z',searchEndAt:'2040-09-30T17:00:00.000Z'};
function fixture(){
 let revision=1;const calls:string[]=[];
 const deps:SelectedCalendarServiceDependencies={client:{rpc:async(name,body)=>{
  calls.push(name);assert.equal(body.target_workspace_id,ws);assert.equal(body.requesting_user_id,user);
  if(name==='load_rev_selected_calendar_credential')return{error:null,data:[{calendar_id:calendar,connection_id:connection,credential_reference:credential,provider_calendar_reference:'selected-id',provider_account_reference:'fake@example.test',timezone:'Europe/London',revision,refresh_token:'fake-refresh'}]};
  assert.equal(name,'rotate_rev_selected_calendar_credential');assert.equal(body.target_calendar_id,calendar);assert.equal(body.target_connection_id,connection);assert.equal(body.target_credential_reference,credential);assert.equal(body.expected_revision,1);assert.equal(body.refresh_token,'fake-rotated');revision=2;
  return{error:null,data:[{credential_reference:credential,revision}]};
 }},refresh:async()=>{calls.push('refresh');return{accessToken:'fake-access',refreshToken:'fake-rotated'};},read:async req=>{calls.push('Graph');assert.equal(req.selectedCalendarId,calendar);return[{startAt:'2040-09-30T10:00:00.000Z',endAt:'2040-09-30T10:30:00.000Z'}];},businessWindows:()=>[{startAt:query.searchStartAt,endAt:query.searchEndAt}]};return{deps,calls};
}
test('service binds verified actor to exact RPCs, rotates before read and excludes credentials from result',async()=>{
 const f=fixture();const result=await createSelectedCalendarAvailabilityService(f.deps)(query);
 assert.deepEqual(f.calls,['load_rev_selected_calendar_credential','refresh','rotate_rev_selected_calendar_credential','load_rev_selected_calendar_credential','Graph','load_rev_selected_calendar_credential']);
 assert.equal(result.selectedCalendar.id,calendar);assert.equal(result.busyIntervals.length,1);assert.ok(!JSON.stringify(result).includes('fake-refresh'));assert.ok(!JSON.stringify(result).includes('fake-access'));assert.ok(!JSON.stringify(result).includes(credential));
});
test('outside business hours does not refresh, rotate or read Graph',async()=>{
 const f=fixture();f.deps.businessWindows=()=>[];const result=await createSelectedCalendarAvailabilityService(f.deps)(query);assert.deepEqual(result.busyIntervals,[]);assert.deepEqual(f.calls,['load_rev_selected_calendar_credential']);
});
test('empty selected calendar on a future local working day still returns business-hour slots',async()=>{
 const f=fixture();
 const searchStartAt='2040-09-30T23:00:00.000Z',searchEndAt='2040-10-01T23:00:00.000Z';
 f.deps.businessWindows=(timezone,start,end)=>buildBusinessHoursAvailabilityWindows({
  workingDays:'1,2,3,4,5',businessStartLocal:'09:00',businessEndLocal:'17:00',timezone,
 },start,end);
 f.deps.read=async request=>{f.calls.push('Graph');assert.equal(request.searchStartAt,searchStartAt);assert.equal(request.searchEndAt,searchEndAt);return[];};
 const selectedService=createSelectedCalendarAvailabilityService(f.deps);
 const dependencies:CalendarAvailabilityDependencies={
  getAuthenticatedUserId:async()=>user,hasActiveWorkspaceMembership:async()=>true,isCalendarAvailabilityEnabled:()=>true,
  resolveTrustedCalendarAvailability:async()=>{throw new Error('Legacy provider path must not run.');},
  resolveSelectedCalendarAvailability:async(workspaceId,start,end,timezone,userId)=>selectedService({workspaceId,userId,searchStartAt:start,searchEndAt:end,timezone}),
  readBusyIntervals:async()=>{throw new Error('Legacy provider reader must not run.');},
  now:()=> '2040-09-30T00:00:00.000Z',
 };
 const response=await handleCalendarAvailability(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer fake','Content-Type':'application/json'},body:JSON.stringify({
  workspaceId:ws,searchStartAt,searchEndAt,requestedDurationMinutes:30,timezone:'Europe/London',
 })}),dependencies);
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.status,'available');
 assert.equal(body.slots.length,16);
 assert.deepEqual(body.slots[0],{startAt:'2040-10-01T08:00:00.000Z',endAt:'2040-10-01T08:30:00.000Z'});
 assert.deepEqual(body.slots.at(-1),{startAt:'2040-10-01T15:30:00.000Z',endAt:'2040-10-01T16:00:00.000Z'});
 assert.equal(f.calls.filter(call=>call==='Graph').length,1);
});
test('lookup refusal and malformed/multiple rows fail without refresh or fallback',async()=>{
 for(const data of [[],[{}],[{},{}]]){const f=fixture();f.deps.client.rpc=async()=>({data,error:null});await assert.rejects(createSelectedCalendarAvailabilityService(f.deps)(query));assert.deepEqual(f.calls,[]);}
 const f=fixture();f.deps.client.rpc=async()=>({data:null,error:{message:'private'}});await assert.rejects(createSelectedCalendarAvailabilityService(f.deps)(query),/Selected calendar unavailable/);assert.deepEqual(f.calls,[]);
});
test('rotation refusal stops Graph without retry',async()=>{
 const f=fixture();const original=f.deps.client.rpc;f.deps.client.rpc=async(name,body)=>name.startsWith('rotate')?{data:null,error:{message:'stale'}}:original(name,body);await assert.rejects(createSelectedCalendarAvailabilityService(f.deps)(query));assert.ok(!f.calls.includes('Graph'));assert.equal(f.calls.filter(c=>c==='refresh').length,1);
});
