import test from 'node:test';
import assert from 'node:assert/strict';
import {AnnualLeaveRecordRefusal,handleAnnualLeaveRecord,type AnnualLeaveRecordDependencies} from './annualLeaveRecordBoundary.ts';

const workspaceId='11111111-1111-4111-8111-111111111111';
const actorId='22222222-2222-4222-8222-222222222222';
const workerId='33333333-3333-4333-8333-333333333333';
const requestId='44444444-4444-4444-8444-444444444444';
const accountId='55555555-5555-4555-8555-555555555555';
const absenceId='66666666-6666-4666-8666-666666666666';
const unavailabilityId='77777777-7777-4777-8777-777777777777';
const origin='http://localhost:5180';
const body={workspaceId,workerId,requestId,startAt:'2026-10-08T11:00:00.000Z',endAt:'2026-10-08T15:00:00.000Z',expectedAccounts:[{accountId,version:1}]};
const request=(value:unknown=body)=>new Request('https://example.test',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+'test','Content-Type':'application/json'},body:JSON.stringify(value)});
function fixture(){
 const calls:unknown[]=[];
 const deps:AnnualLeaveRecordDependencies={
  allowedOrigin:origin,
  getUserId:async()=>actorId,
  canManage:async()=>true,
  record:async input=>{
   calls.push(input);
   return{absence_id:absenceId,unavailability_id:unavailabilityId,workspace_id:workspaceId,worker_id:workerId,start_at:'2026-10-08T11:00:00+00:00',end_at:'2026-10-08T15:00:00+00:00',timezone:'Europe/London',status:'confirmed',version:1,total_deduction_minutes:240,accounts:[{account_id:accountId,version:2,deducted_minutes:240,remaining_minutes:12360}]};
  },
 };
 return{calls,deps};
}
test('manager records authoritative partial-day leave with canonical expected accounts',async()=>{
 const fixtureValue=fixture();
 const response=await handleAnnualLeaveRecord(request(),fixtureValue.deps);
 assert.equal(response.status,200);
 assert.equal(fixtureValue.calls.length,1);
 assert.deepEqual(fixtureValue.calls[0],{target_workspace_id:workspaceId,initiating_user_id:actorId,target_request_id:requestId,target_worker_id:workerId,target_start_at:body.startAt,target_end_at:body.endAt,expected_accounts:[{account_id:accountId,version:1}]});
 assert.deepEqual(await response.json(),{absenceId,unavailabilityId,workspaceId,workerId,startAt:body.startAt,endAt:body.endAt,timezone:'Europe/London',status:'confirmed',version:1,totalDeductionMinutes:240,accounts:[{accountId,version:2,deductedMinutes:240,remainingMinutes:12360}]});
});
test('invalid instants, account revisions and injected calculation fields stop before authority',async()=>{
 for(const patch of[{startAt:'2026-10-08T11:00:30.000Z'},{endAt:body.startAt},{expectedAccounts:[]},{expectedAccounts:[{accountId,version:0}]},{timezone:'Europe/London'},{deductionMinutes:1}]){
  const fixtureValue=fixture();
  assert.equal((await handleAnnualLeaveRecord(request({...body,...patch}),fixtureValue.deps)).status,400);
  assert.deepEqual(fixtureValue.calls,[]);
 }
});
test('allowlisted transactional refusals are request-bound',async()=>{
 for(const code of['missing_pattern','ambiguous_pattern_time','missing_calendar','calendar_year_unconfirmed','missing_account','stale_account','insufficient_balance','assignment_conflict','overlap','request_conflict']as const){
  const fixtureValue=fixture();
  fixtureValue.deps.record=async()=>{throw new AnnualLeaveRecordRefusal(code);};
  const response=await handleAnnualLeaveRecord(request(),fixtureValue.deps);
  assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{status:'refused',code,requestId});
 }
});
test('arbitrary failures and malformed success remain outcome unknown without retry',async()=>{
 for(const mode of['private','malformed']){
  const fixtureValue=fixture();
  let calls=0;
  const original=fixtureValue.deps.record;
  fixtureValue.deps.record=async input=>{
   calls++;
   if(mode==='private')throw Error('Annual leave account unavailable');
   return{...await original(input)as object,total_deduction_minutes:-1};
  };
  const response=await handleAnnualLeaveRecord(request(),fixtureValue.deps);
  assert.equal(response.status,503);
  assert.equal(calls,1);
  assert.deepEqual(await response.json(),{error:'Annual leave recording outcome could not be confirmed.',code:'outcome_unknown'});
 }
});
test('duplicate, missing, foreign, stale and inconsistent account results remain outcome unknown',async()=>{
 const secondAccountId='88888888-8888-4888-8888-888888888888';
 const twoAccountBody={...body,expectedAccounts:[{accountId,version:1},{accountId:secondAccountId,version:4}]};
 const validAccounts=[
  {account_id:accountId,version:2,deducted_minutes:120,remaining_minutes:12480},
  {account_id:secondAccountId,version:5,deducted_minutes:120,remaining_minutes:12480},
 ];
 const malformed=[
  [validAccounts[0],validAccounts[0]],
  [validAccounts[0]],
  [validAccounts[0],{...validAccounts[1],account_id:absenceId}],
  [validAccounts[0],{...validAccounts[1],version:4}],
  [{...validAccounts[0],deducted_minutes:119},validAccounts[1]],
 ];
 for(const accounts of malformed){
  const fixtureValue=fixture();
  fixtureValue.deps.record=async()=>({absence_id:absenceId,unavailability_id:unavailabilityId,workspace_id:workspaceId,worker_id:workerId,start_at:'2026-10-08T11:00:00+00:00',end_at:'2026-10-08T15:00:00+00:00',timezone:'Europe/London',status:'confirmed',version:1,total_deduction_minutes:240,accounts});
  const response=await handleAnnualLeaveRecord(request(twoAccountBody),fixtureValue.deps);
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'Annual leave recording outcome could not be confirmed.',code:'outcome_unknown'});
 }
});
