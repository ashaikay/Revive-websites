import test from 'node:test';
import assert from 'node:assert/strict';
import {BankHolidayRefusal,handleWorkspaceBankHolidaySave,type WorkspaceBankHolidayDependencies} from './workspaceBankHolidayBoundary.ts';

const workspaceId='11111111-1111-4111-8111-111111111111';
const actorId='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const holidayId='44444444-4444-4444-8444-444444444444';
const calendarId='55555555-5555-4555-8555-555555555555';
const origin='http://localhost:5180';
const body={workspaceId,calendarId,requestId,holidayId:null,holidayDate:'2026-12-25',name:'Christmas Day',status:'active',expectedVersion:0};
const request=(value:unknown=body)=>new Request('https://example.test',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+'test','Content-Type':'application/json'},body:JSON.stringify(value)});
function fixture(){
 const calls:unknown[]=[];
 const deps:WorkspaceBankHolidayDependencies={
  allowedOrigin:origin,
  getUserId:async()=>actorId,
  canManage:async()=>true,
  save:async input=>{
   calls.push(input);
   return{holiday_id:input.target_holiday_id??holidayId,workspace_id:workspaceId,calendar_id:calendarId,holiday_date:input.target_holiday_date,name:input.target_name,status:input.target_status,version:input.expected_version+1};
  },
 };
 return{calls,deps};
}
test('holiday preflight allows both exact development origins and rejects missing or unrelated origins',async()=>{
 for(const requestOrigin of['http://localhost:5180','http://127.0.0.1:5180']){
  const value=fixture();let auth=0;value.deps.getUserId=async()=>{auth++;return actorId;};
  const response=await handleWorkspaceBankHolidaySave(new Request('https://example.test',{method:'OPTIONS',headers:{Origin:requestOrigin}}),value.deps);
  assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),requestOrigin);assert.equal(response.headers.get('Vary'),'Origin');assert.equal(auth,0);assert.equal(value.calls.length,0);
 }
 for(const requestOrigin of[undefined,'https://unrelated.example']){
  const value=fixture();let auth=0;value.deps.getUserId=async()=>{auth++;return actorId;};
  const response=await handleWorkspaceBankHolidaySave(new Request('https://example.test',{method:'OPTIONS',headers:requestOrigin?{Origin:requestOrigin}:undefined}),value.deps);
  assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);assert.equal(auth,0);assert.equal(value.calls.length,0);
 }
});
test('manager saves an authoritative workspace holiday',async()=>{
 const fixtureValue=fixture();
 const response=await handleWorkspaceBankHolidaySave(request(),fixtureValue.deps);
 assert.equal(response.status,200);
 assert.equal(fixtureValue.calls.length,1);
 assert.deepEqual(await response.json(),{holidayId,workspaceId,calendarId,holidayDate:'2026-12-25',name:'Christmas Day',status:'active',version:1});
});
test('invalid holiday input and injected authority stop before save',async()=>{
 for(const patch of[{calendarId:null},{holidayDate:'2026-02-30'},{name:' padded '},{status:'cancelled'},{expectedVersion:1},{countryCode:'GB'}]){
  const fixtureValue=fixture();
  assert.equal((await handleWorkspaceBankHolidaySave(request({...body,...patch}),fixtureValue.deps)).status,400);
  assert.deepEqual(fixtureValue.calls,[]);
 }
});
test('known holiday refusals are scoped and unknown failures remain unknown',async()=>{
 for(const code of['stale_holiday','date_conflict','request_conflict']as const){
  const fixtureValue=fixture();
  fixtureValue.deps.save=async()=>{throw new BankHolidayRefusal(code);};
  const response=await handleWorkspaceBankHolidaySave(request(),fixtureValue.deps);
  assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{status:'refused',code,requestId});
 }
 const unknown=fixture();
 unknown.deps.save=async()=>{throw Error('Bank holiday already exists');};
 assert.equal((await handleWorkspaceBankHolidaySave(request(),unknown.deps)).status,503);
});
