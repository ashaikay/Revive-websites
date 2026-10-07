import test from 'node:test';
import assert from 'node:assert/strict';
import {AnnualLeaveCalendarRefusal,handleAnnualLeaveCalendarConfigure,type AnnualLeaveCalendarDependencies} from './annualLeaveCalendarBoundary.ts';

const workspaceId='11111111-1111-4111-8111-111111111111';
const actorId='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const calendarId='44444444-4444-4444-8444-444444444444';
const workerId='55555555-5555-4555-8555-555555555555';
const origin='http://localhost:5180';
const request=(body:unknown)=>new Request('https://example.test',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+'test','Content-Type':'application/json'},body:JSON.stringify(body)});
function fixture(){
 const calls:unknown[]=[];
 const deps:AnnualLeaveCalendarDependencies={
  allowedOrigin:origin,
  getUserId:async()=>actorId,
  canManage:async()=>true,
  configure:async input=>{
   calls.push(input);
   if(input.target_action==='save_calendar')return{action:input.target_action,workspace_id:workspaceId,calendar_id:calendarId,name:input.target_name,region_code:input.target_region_code,status:input.target_status,version:1};
   if(input.target_action==='assign_worker')return{action:input.target_action,workspace_id:workspaceId,worker_id:workerId,calendar_id:calendarId,version:1};
   return{action:input.target_action,workspace_id:workspaceId,calendar_id:calendarId,calendar_year:2027,revision:1,confirmed_revision:1};
  },
 };
 return{calls,deps};
}
test('calendar preflight allows both exact development origins and rejects missing or unrelated origins',async()=>{
 for(const requestOrigin of['http://localhost:5180','http://127.0.0.1:5180']){
  const value=fixture();let auth=0;value.deps.getUserId=async()=>{auth++;return actorId;};
  const response=await handleAnnualLeaveCalendarConfigure(new Request('https://example.test',{method:'OPTIONS',headers:{Origin:requestOrigin}}),value.deps);
  assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),requestOrigin);assert.equal(response.headers.get('Vary'),'Origin');assert.equal(auth,0);assert.equal(value.calls.length,0);
 }
 for(const requestOrigin of[undefined,'https://unrelated.example']){
  const value=fixture();let auth=0;value.deps.getUserId=async()=>{auth++;return actorId;};
  const response=await handleAnnualLeaveCalendarConfigure(new Request('https://example.test',{method:'OPTIONS',headers:requestOrigin?{Origin:requestOrigin}:undefined}),value.deps);
  assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);assert.equal(auth,0);assert.equal(value.calls.length,0);
 }
});
test('manager creates, assigns and confirms an explicit annual leave calendar',async()=>{
 const cases=[
  [{action:'save_calendar',workspaceId,requestId,calendarId:null,name:'England and Wales',regionCode:'GB-EAW',status:'active',expectedVersion:0},'save_calendar'],
  [{action:'assign_worker',workspaceId,requestId,calendarId,workerId,expectedVersion:0},'assign_worker'],
  [{action:'confirm_year',workspaceId,requestId,calendarId,calendarYear:2027,expectedVersion:0},'confirm_year'],
 ] as const;
 for(const [body,action] of cases){
  const value=fixture();
  const response=await handleAnnualLeaveCalendarConfigure(request(body),value.deps);
  assert.equal(response.status,200);
  assert.equal((await response.json()).action,action);
  assert.equal(value.calls.length,1);
 }
});
test('invalid calendar configuration and injected fields stop before authority',async()=>{
 for(const body of[
  {action:'save_calendar',workspaceId,requestId,calendarId:null,name:'England',regionCode:'gb',status:'active',expectedVersion:0},
  {action:'assign_worker',workspaceId,requestId,calendarId,workerId,expectedVersion:-1},
  {action:'confirm_year',workspaceId,requestId,calendarId,calendarYear:999,expectedVersion:0},
  {action:'confirm_year',workspaceId,requestId,calendarId,calendarYear:2027,expectedVersion:0,timezone:'Europe/London'},
 ]){
  const value=fixture();
  assert.equal((await handleAnnualLeaveCalendarConfigure(request(body),value.deps)).status,400);
  assert.deepEqual(value.calls,[]);
 }
});
test('blank calendar names are rejected before authentication or authority',async()=>{
 const value=fixture();let auth=0;
 value.deps.getUserId=async()=>{auth++;return actorId;};
 const response=await handleAnnualLeaveCalendarConfigure(request({action:'save_calendar',workspaceId,requestId,calendarId:null,name:'',regionCode:'GB-ENG',status:'active',expectedVersion:0}),value.deps);
 assert.equal(response.status,400);
 assert.equal(auth,0);
 assert.deepEqual(value.calls,[]);
});
test('known calendar refusals are request-bound and unknown failures remain unknown',async()=>{
 const body={action:'confirm_year',workspaceId,requestId,calendarId,calendarYear:2027,expectedVersion:0};
 for(const code of['stale_calendar','calendar_exists','stale_assignment','stale_year','missing_calendar','request_conflict']as const){
  const value=fixture();
  value.deps.configure=async()=>{throw new AnnualLeaveCalendarRefusal(code);};
  const response=await handleAnnualLeaveCalendarConfigure(request(body),value.deps);
  assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{status:'refused',code,requestId});
 }
 const value=fixture();
 value.deps.configure=async()=>{throw Error('Annual leave calendar unavailable');};
 assert.equal((await handleAnnualLeaveCalendarConfigure(request(body),value.deps)).status,503);
});
