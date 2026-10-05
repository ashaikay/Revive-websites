import test from 'node:test';
import assert from 'node:assert/strict';
import {handleLegacyAnnualLeaveCancel,LegacyAnnualLeaveCancelRefusal,type LegacyAnnualLeaveCancelDependencies} from './legacyAnnualLeaveCancelBoundary.ts';

const workspaceId='11111111-1111-4111-8111-111111111111';
const actorId='22222222-2222-4222-8222-222222222222';
const workerId='33333333-3333-4333-8333-333333333333';
const unavailabilityId='44444444-4444-4444-8444-444444444444';
const requestId='55555555-5555-4555-8555-555555555555';
const origin='http://localhost:5180';
const body={workspaceId,workerId,unavailabilityId,requestId,expectedVersion:1};
const request=(value:unknown=body)=>new Request('https://example.test',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+'test','Content-Type':'application/json'},body:JSON.stringify(value)});
function fixture(){
 const calls:unknown[]=[];
 const deps:LegacyAnnualLeaveCancelDependencies={
  allowedOrigin:origin,
  getUserId:async()=>actorId,
  canManage:async()=>true,
  cancel:async input=>{
   calls.push(input);
   return{unavailability_id:unavailabilityId,workspace_id:workspaceId,worker_id:workerId,start_at:'2026-01-02T09:00:00+00:00',end_at:'2026-01-02T17:00:00+00:00',category:'leave',status:'cancelled',version:2};
  },
 };
 return{calls,deps};
}
test('legacy cancellation preflight allows both exact development origins and rejects missing or unrelated origins',async()=>{
 for(const requestOrigin of['http://localhost:5180','http://127.0.0.1:5180']){
  const value=fixture();let auth=0;value.deps.getUserId=async()=>{auth++;return actorId;};
  const response=await handleLegacyAnnualLeaveCancel(new Request('https://example.test',{method:'OPTIONS',headers:{Origin:requestOrigin}}),value.deps);
  assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),requestOrigin);assert.equal(response.headers.get('Vary'),'Origin');assert.equal(auth,0);assert.equal(value.calls.length,0);
 }
 for(const requestOrigin of[undefined,'https://unrelated.example']){
  const value=fixture();let auth=0;value.deps.getUserId=async()=>{auth++;return actorId;};
  const response=await handleLegacyAnnualLeaveCancel(new Request('https://example.test',{method:'OPTIONS',headers:requestOrigin?{Origin:requestOrigin}:undefined}),value.deps);
  assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);assert.equal(auth,0);assert.equal(value.calls.length,0);
 }
});
test('manager cancels historical leave without changing its interval or category',async()=>{
 const value=fixture();
 const response=await handleLegacyAnnualLeaveCancel(request(),value.deps);
 assert.equal(response.status,200);
 assert.deepEqual(value.calls,[{target_workspace_id:workspaceId,initiating_user_id:actorId,target_request_id:requestId,target_worker_id:workerId,target_unavailability_id:unavailabilityId,expected_version:1}]);
 assert.deepEqual(await response.json(),{unavailabilityId,workspaceId,workerId,startAt:'2026-01-02T09:00:00.000Z',endAt:'2026-01-02T17:00:00.000Z',category:'leave',status:'cancelled',version:2});
});
test('invalid historical cancellation never reaches authority',async()=>{
 for(const patch of[{expectedVersion:0},{workerId:null},{category:'leave'}]){
  const value=fixture();
  assert.equal((await handleLegacyAnnualLeaveCancel(request({...body,...patch}),value.deps)).status,400);
  assert.deepEqual(value.calls,[]);
 }
});
test('known historical refusals are scoped and arbitrary failures remain unknown',async()=>{
 for(const code of['stale_legacy_leave','already_cancelled','accounted_leave','request_conflict']as const){
  const value=fixture();
  value.deps.cancel=async()=>{throw new LegacyAnnualLeaveCancelRefusal(code);};
  const response=await handleLegacyAnnualLeaveCancel(request(),value.deps);
  assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{status:'refused',code,requestId});
 }
 const value=fixture();
 value.deps.cancel=async()=>{throw Error('Annual leave accounting cancellation required');};
 assert.equal((await handleLegacyAnnualLeaveCancel(request(),value.deps)).status,503);
});
