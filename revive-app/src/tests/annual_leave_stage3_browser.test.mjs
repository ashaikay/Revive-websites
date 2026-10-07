import test from 'node:test';
import assert from 'node:assert/strict';
import {annualLeaveColumns,annualLeaveOrderColumns,createAnnualLeaveScopeGuard,expectedAccountsForDates,formatLeaveDays,formatLeaveMinutes,formatLeaveDayTotal,formatAnnualLeaveRange,formatAnnualLeaveAbsenceDays,invalidAnnualLeaveAttemptMessage,loadAnnualLeavePages,loadAnnualLeaveWorkspace,rememberAnnualLeaveAttempt,restoreAnnualLeaveAttempt,submitAnnualLeaveAttempt,AnnualLeaveRefused} from '../services/annualLeave.ts';

const ws='11111111-1111-4111-8111-111111111111',worker='22222222-2222-4222-8222-222222222222',user='33333333-3333-4333-8333-333333333333',account='44444444-4444-4444-8444-444444444444',absence='55555555-5555-4555-8555-555555555555',unavailability='66666666-6666-4666-8666-666666666666',calendar='77777777-7777-4777-8777-777777777777',request='88888888-8888-4888-8888-888888888888';
function fixture(){
 return{
  annual_leave_policies:[{id:'99999999-9999-4999-8999-999999999999',workspace_id:ws,worker_id:null,version:1,effective_from_leave_year:2026,allowance_input_unit:'days',allowance_input_value:1.3333,allowance_minutes:600,hours_per_day_minutes:450,leave_year_start_month:1,leave_year_start_day:1,bank_holiday_treatment:'included'}],
  annual_leave_accounts:[{id:account,workspace_id:ws,worker_id:worker,leave_year_start:'2026-01-01',leave_year_end_exclusive:'2027-01-01',configured_allowance_minutes:600,hours_per_day_minutes:450,bank_holiday_treatment:'included',adjustment_total_minutes:60,recorded_leave_minutes:90,version:4}],
  annual_leave_adjustments:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',workspace_id:ws,account_id:account,worker_id:worker,adjustment_minutes:60,reason:'Carry over',account_version:2,created_at:'2026-01-02T00:00:00Z'}],
  annual_leave_postings:[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',workspace_id:ws,absence_id:absence,account_id:account,posting_kind:'deduction',minutes:120,account_version:3,created_at:'2026-02-01T00:00:00Z'},{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',workspace_id:ws,absence_id:absence,account_id:account,posting_kind:'reversal',minutes:-30,account_version:4,created_at:'2026-02-02T00:00:00Z'}],
  annual_leave_absences:[{id:absence,workspace_id:ws,worker_id:worker,unavailability_id:unavailability,start_at:'2026-02-01T09:00:00Z',end_at:'2026-02-01T11:00:00Z',timezone:'Europe/London',total_deduction_minutes:120,status:'cancelled',version:2,created_at:'2026-02-01T00:00:00Z',cancelled_at:'2026-02-02T00:00:00Z'}],
  annual_leave_calculation_segments:[{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',workspace_id:ws,absence_id:absence,worker_id:worker,account_id:account,local_date:'2026-02-01',deduction_minutes:120}],
  annual_leave_calendars:[{id:calendar,workspace_id:ws,name:'England',region_code:'GB-ENG',status:'active',version:1}],
  annual_leave_worker_calendars:[{workspace_id:ws,worker_id:worker,calendar_id:calendar,version:1}],
  annual_leave_calendar_years:[{workspace_id:ws,calendar_id:calendar,calendar_year:2026,revision:2,confirmed_revision:2,confirmed_at:'2026-01-01T00:00:00Z'}],
  workspace_bank_holidays:[{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',workspace_id:ws,calendar_id:calendar,holiday_date:'2026-12-25',name:'Christmas Day',status:'active',version:1}],
  scheduling_worker_patterns:[{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',workspace_id:ws,worker_id:worker,timezone:'Europe/London',effective_from:'2026-01-01',effective_until:null,version:1}],
  scheduling_worker_unavailability:[{id:unavailability,workspace_id:ws,worker_id:worker,start_at:'2026-02-01T09:00:00Z',end_at:'2026-02-01T11:00:00Z',category:'leave',status:'cancelled',version:2},{id:'12121212-1212-4212-8212-121212121212',workspace_id:ws,worker_id:worker,start_at:'2025-12-01T09:00:00Z',end_at:'2025-12-01T17:00:00Z',category:'leave',status:'active',version:1}],
 };
}
const reader=data=>async(table,columns,workspaceId,workerId,accountIds)=>{assert.equal(columns,annualLeaveColumns[table]);assert.equal(workspaceId,ws);assert.equal(workerId,worker);if(table==='annual_leave_postings')assert.deepEqual(accountIds,[account]);return data[table];};

test('reconciles allowance, adjustments and postings into an authoritative balance',async()=>{
 const model=await loadAnnualLeaveWorkspace(ws,worker,reader(fixture()));
 assert.deepEqual(model.accounts[0],{accountId:account,workerId:worker,leaveYearStart:'2026-01-01',leaveYearEndExclusive:'2027-01-01',configuredAllowanceMinutes:600,adjustmentTotalMinutes:60,recordedLeaveMinutes:90,remainingMinutes:570,hoursPerDayMinutes:450,bankHolidayTreatment:'included',version:4});
 assert.equal(model.timezone,'Europe/London');assert.equal(model.assignedCalendarId,calendar);assert.equal(model.legacyLeave.length,1);assert.equal(model.absences[0].accountIds[0],account);
 assert.equal(formatLeaveMinutes(570),'9h 30m');assert.equal(formatLeaveDays(570,450),'1.27 days at 7h 30m per day');
});

test('fails closed when account totals do not reconcile with immutable evidence',async()=>{
 const data=fixture();data.annual_leave_accounts[0].recorded_leave_minutes=89;
 await assert.rejects(loadAnnualLeaveWorkspace(ws,worker,reader(data)),/does not reconcile/);
});

test('requires complete existing account coverage across selected local dates',async()=>{
 const model=await loadAnnualLeaveWorkspace(ws,worker,reader(fixture()));
 assert.deepEqual(expectedAccountsForDates(model,'2026-12-30','2026-12-31'),[{accountId:account,version:4}]);
 assert.throws(()=>expectedAccountsForDates(model,'2026-12-31','2027-01-02'),/account unavailable/);
});

test('retains exact request identity for explicit retries and scopes recovery by workspace and user',async()=>{
 const body={workspaceId:ws,workerId:worker,requestId:request,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',expectedAccounts:[{accountId:account,version:4}]};
 const attempt={operation:'record',workspaceId:ws,workerId:worker,requestId:request,body},values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 rememberAnnualLeaveAttempt(storage,user,attempt);assert.deepEqual(restoreAnnualLeaveAttempt(storage,ws,user),attempt);assert.equal(restoreAnnualLeaveAttempt(storage,'10101010-1010-4010-8010-101010101010',user),null);
 let invoked;const result=await submitAnnualLeaveAttempt(attempt,async(name,payload)=>{invoked={name,payload};return{status:200,data:{absenceId:absence,unavailabilityId:unavailability,workspaceId:ws,workerId:worker,startAt:body.startAt,endAt:body.endAt,timezone:'Europe/London',status:'confirmed',version:1,totalDeductionMinutes:450,accounts:[{accountId:account,version:5,deductedMinutes:450,remainingMinutes:120}]}};});
 assert.equal(result.absenceId,absence);assert.deepEqual(invoked,{name:'rev-annual-leave-record',payload:body});
});

test('only retained blank calendar creation is locally dismissible',()=>{
 const blank={operation:'calendar',workspaceId:ws,workerId:worker,requestId:request,body:{workspaceId:ws,requestId:request,action:'save_calendar',calendarId:null,name:'',regionCode:'GB-ENG',status:'active',expectedVersion:0}};
 const valid={...blank,body:{...blank.body,name:'England holidays'}};
 const uncertain={operation:'record',workspaceId:ws,workerId:worker,requestId:request,body:{workspaceId:ws,workerId:worker,requestId:request,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',expectedAccounts:[{accountId:account,version:4}]}};
 assert.equal(invalidAnnualLeaveAttemptMessage(blank),'Enter a calendar name.');
 assert.equal(invalidAnnualLeaveAttemptMessage(valid),null);
 assert.equal(invalidAnnualLeaveAttemptMessage(uncertain),null);
});

test('accepts only request-bound known refusals and leaves unknown outcomes uncertain',async()=>{
 const body={workspaceId:ws,workerId:worker,requestId:request,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',expectedAccounts:[{accountId:account,version:4}]},attempt={operation:'record',workspaceId:ws,workerId:worker,requestId:request,body};
 await assert.rejects(submitAnnualLeaveAttempt(attempt,async()=>({status:409,data:{status:'refused',code:'calendar_year_unconfirmed',requestId:request}})),error=>error instanceof AnnualLeaveRefused&&error.code==='calendar_year_unconfirmed');
 await assert.rejects(submitAnnualLeaveAttempt(attempt,async()=>({status:409,data:{status:'refused',code:'calendar_year_unconfirmed',requestId:'abababab-abab-4bab-8bab-abababababab'}})),/unconfirmed/);
 await assert.rejects(submitAnnualLeaveAttempt(attempt,async()=>({status:503,data:{code:'outcome_unknown'}})),/unconfirmed/);
});

test('paginates with stable unique ordering and probes beyond the exact 1,000-row limit',async()=>{
 const calls=[],pages=[Array.from({length:250},(_,index)=>index),Array.from({length:250},(_,index)=>index+250),[500,501]];
 const result=await loadAnnualLeavePages('annual_leave_calendar_years',async(from,to,orderColumns)=>{calls.push({from,to,orderColumns});return pages.shift();});
 assert.equal(result.length,502);assert.deepEqual(calls.map(call=>[call.from,call.to]),[[0,249],[250,499],[500,749]]);assert.deepEqual(calls[0].orderColumns,annualLeaveOrderColumns.annual_leave_calendar_years);assert.deepEqual(calls[0].orderColumns,['workspace_id','calendar_id','calendar_year']);
 let page=0;await assert.rejects(loadAnnualLeavePages('annual_leave_postings',async(from,to,orderColumns)=>{assert.deepEqual(orderColumns,['id']);assert.equal(from,page*250);assert.equal(to,from+249);page++;return page<=4?Array.from({length:250},(_,index)=>index):[1000];}),/exceeds the 1,000-row safety limit; no partial data shown/);assert.equal(page,5);
});

test('scope changes invalidate in-flight completion and retain recovery under its original workspace and user',()=>{
 const otherUser='90909090-9090-4090-8090-909090909090',guard=createAnnualLeaveScopeGuard(`${ws}:${user}`),token=guard.capture(),body={workspaceId:ws,workerId:worker,requestId:request,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',expectedAccounts:[{accountId:account,version:4}]},attempt={operation:'record',workspaceId:ws,workerId:worker,requestId:request,body},values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 rememberAnnualLeaveAttempt(storage,user,attempt);guard.update(`${ws}:${otherUser}`);assert.equal(guard.isCurrent(token),false);const beforeCleanup=guard.capture();guard.deactivate();assert.equal(guard.isCurrent(beforeCleanup),false);guard.activate();assert.equal(guard.isCurrent(beforeCleanup),false);assert.equal(guard.isCurrent(guard.capture()),true);assert.deepEqual(restoreAnnualLeaveAttempt(storage,ws,user),attempt);assert.equal(restoreAnnualLeaveAttempt(storage,ws,otherUser),null);
});

test('displays simple days and inclusive local dates across daylight-saving changes',()=>{
 assert.equal(formatLeaveDayTotal(2520,450),'5.60 days');
 assert.equal(formatLeaveDayTotal(450,450),'1 day');
 assert.equal(formatLeaveDayTotal(-225,450),'-0.50 days');
 assert.equal(formatAnnualLeaveRange('2026-10-06T23:00:00.000Z','2026-10-16T23:00:00.000Z','Europe/London'),'07/10/2026 to 16/10/2026');
 assert.equal(formatAnnualLeaveRange('2026-03-28T00:00:00.000Z','2026-03-29T23:00:00.000Z','Europe/London'),'28/03/2026 to 29/03/2026');
 assert.equal(formatAnnualLeaveRange('2026-10-23T23:00:00.000Z','2026-10-26T00:00:00.000Z','Europe/London'),'24/10/2026 to 25/10/2026');
 assert.equal(formatAnnualLeaveRange('2026-10-05T08:00:00.000Z','2026-10-05T12:00:00.000Z','Europe/London'),'05/10/2026, 09:00 to 05/10/2026, 13:00');
});
test('converts history using each leave account snapshot, never the current working pattern',async()=>{
 const model=await loadAnnualLeaveWorkspace(ws,worker,reader(fixture()));
 assert.deepEqual(model.absences[0].deductionMinutesByAccount,{[account]:120});
 assert.equal(formatAnnualLeaveAbsenceDays(model.absences[0],model.accounts),'0.27 days');
 const second='abababab-abab-4bab-8bab-abababababab';
 const conversions=[{...model.accounts[0],hoursPerDayMinutes:450},{...model.accounts[0],accountId:second,hoursPerDayMinutes:480}];
 const acrossYears={...model.absences[0],accountIds:[account,second],totalDeductionMinutes:930,deductionMinutesByAccount:{[account]:450,[second]:480}};
 assert.equal(formatAnnualLeaveAbsenceDays(acrossYears,conversions),'2 days');
 assert.equal(formatAnnualLeaveAbsenceDays({...acrossYears,deductionMinutesByAccount:undefined},conversions),'Day conversion unavailable');
 assert.equal(formatAnnualLeaveAbsenceDays({...acrossYears,deductionMinutesByAccount:{[account]:450,[second]:479}},conversions),'Day conversion unavailable');
 assert.equal(formatAnnualLeaveAbsenceDays(acrossYears,[]),'Day conversion unavailable');
});
