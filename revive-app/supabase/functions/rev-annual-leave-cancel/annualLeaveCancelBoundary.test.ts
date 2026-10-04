import test from 'node:test';
import assert from 'node:assert/strict';
import {AnnualLeaveCancelRefusal,handleAnnualLeaveCancel,type AnnualLeaveCancelDependencies} from './annualLeaveCancelBoundary.ts';

const workspaceId='11111111-1111-4111-8111-111111111111';
const actorId='22222222-2222-4222-8222-222222222222';
const absenceId='33333333-3333-4333-8333-333333333333';
const requestId='44444444-4444-4444-8444-444444444444';
const accountId='55555555-5555-4555-8555-555555555555';
const workerId='66666666-6666-4666-8666-666666666666';
const origin='http://localhost:5180';
const body={workspaceId,absenceId,requestId,expectedVersion:1,expectedAccounts:[{accountId,version:2}]};
const request=(value:unknown=body)=>new Request('https://example.test',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+'test','Content-Type':'application/json'},body:JSON.stringify(value)});
function fixture(){
 const calls:unknown[]=[];
 const deps:AnnualLeaveCancelDependencies={
  allowedOrigin:origin,
  getUserId:async()=>actorId,
  canManage:async()=>true,
  cancel:async input=>{
   calls.push(input);
   return{absence_id:absenceId,workspace_id:workspaceId,worker_id:workerId,status:'cancelled',version:2,reversed_minutes:450,accounts:[{account_id:accountId,version:3,remaining_minutes:12600}]};
  },
 };
 return{calls,deps};
}
test('manager cancellation carries exact absence and account revisions',async()=>{
 const fixtureValue=fixture();
 const response=await handleAnnualLeaveCancel(request(),fixtureValue.deps);
 assert.equal(response.status,200);
 assert.deepEqual(fixtureValue.calls,[{target_workspace_id:workspaceId,initiating_user_id:actorId,target_request_id:requestId,target_absence_id:absenceId,expected_version:1,expected_accounts:[{account_id:accountId,version:2}]}]);
 assert.deepEqual(await response.json(),{absenceId,workspaceId,workerId,status:'cancelled',version:2,reversedMinutes:450,accounts:[{accountId,version:3,remainingMinutes:12600}]});
});
test('invalid cancellation shape never reaches authority',async()=>{
 for(const patch of[{expectedVersion:0},{expectedAccounts:[]},{expectedAccounts:[{accountId,version:0}]},{workerId}]){
  const fixtureValue=fixture();
  assert.equal((await handleAnnualLeaveCancel(request({...body,...patch}),fixtureValue.deps)).status,400);
  assert.deepEqual(fixtureValue.calls,[]);
 }
});
test('known cancellation refusals are request-bound while arbitrary text stays unknown',async()=>{
 for(const code of['stale_absence','already_cancelled','stale_account','request_conflict']as const){
  const fixtureValue=fixture();
  fixtureValue.deps.cancel=async()=>{throw new AnnualLeaveCancelRefusal(code);};
  const response=await handleAnnualLeaveCancel(request(),fixtureValue.deps);
  assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{status:'refused',code,requestId});
 }
 const unknown=fixture();
 unknown.deps.cancel=async()=>{throw Error('Annual leave already cancelled');};
 const response=await handleAnnualLeaveCancel(request(),unknown.deps);
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'Annual leave cancellation outcome could not be confirmed.',code:'outcome_unknown'});
});
test('duplicate, missing, foreign and incorrect-revision account results remain outcome unknown',async()=>{
 const secondAccountId='77777777-7777-4777-8777-777777777777';
 const twoAccountBody={...body,expectedAccounts:[{accountId,version:2},{accountId:secondAccountId,version:5}]};
 const validAccounts=[
  {account_id:accountId,version:3,remaining_minutes:12600},
  {account_id:secondAccountId,version:6,remaining_minutes:8400},
 ];
 for(const accounts of[
  [validAccounts[0],validAccounts[0]],
  [validAccounts[0]],
  [validAccounts[0],{...validAccounts[1],account_id:absenceId}],
  [validAccounts[0],{...validAccounts[1],version:5}],
 ]){
  const fixtureValue=fixture();
  fixtureValue.deps.cancel=async()=>({absence_id:absenceId,workspace_id:workspaceId,worker_id:workerId,status:'cancelled',version:2,reversed_minutes:450,accounts});
  const response=await handleAnnualLeaveCancel(request(twoAccountBody),fixtureValue.deps);
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'Annual leave cancellation outcome could not be confirmed.',code:'outcome_unknown'});
 }
});
