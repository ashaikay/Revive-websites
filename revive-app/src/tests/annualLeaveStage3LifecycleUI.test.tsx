// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {AnnualLeaveAttempt} from '@/services/annualLeave';
import type {Worker} from '@/services/schedulingWorkers';

const mocks=vi.hoisted(()=>({invoke:vi.fn(),range:vi.fn(),rows:new Map<string,unknown[]>()}));
vi.mock('@/data/supabaseClient',()=>{
 const query=(table:string)=>{
  const value:{select:(columns:string)=>typeof value;eq:(key:string,item:unknown)=>typeof value;or:(filter:string)=>typeof value;in:(key:string,items:unknown[])=>typeof value;order:(column:string,options:unknown)=>typeof value;range:(from:number,to:number)=>unknown}={select:()=>value,eq:()=>value,or:()=>value,in:()=>value,order:()=>value,range:(from,to)=>mocks.range(table,from,to)};
  return value;
 };
 return{supabaseClient:{functions:{invoke:mocks.invoke},from:(table:string)=>query(table)}};
});

import {AnnualLeaveView} from '@/components/AnnualLeaveView';
import {rememberAnnualLeaveAttempt} from '@/services/annualLeave';

const wsA='11111111-1111-4111-8111-111111111111',userA='22222222-2222-4222-8222-222222222222',workerA='33333333-3333-4333-8333-333333333333',requestA='44444444-4444-4444-8444-444444444444',accountA='55555555-5555-4555-8555-555555555555';
const wsB='66666666-6666-4666-8666-666666666666',userB='77777777-7777-4777-8777-777777777777',workerB='88888888-8888-4888-8888-888888888888',requestB='99999999-9999-4999-8999-999999999999',accountB='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const worker=(workspaceId:string,workerId:string,name:string):Worker=>({workspaceId,workerId,displayName:name,roleLabels:[],skillTags:[],active:true,version:1});
const attempt=(workspaceId:string,workerId:string,requestId:string,accountId:string):AnnualLeaveAttempt=>({operation:'record',workspaceId,workerId,requestId,body:{workspaceId,workerId,requestId,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',expectedAccounts:[{accountId,version:1}]}});
const success=(workspaceId:string,workerId:string,request:AnnualLeaveAttempt)=>({data:{absenceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',unavailabilityId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',workspaceId,workerId,startAt:request.body.startAt,endAt:request.body.endAt,timezone:'Europe/London',status:'confirmed',version:1,totalDeductionMinutes:450,accounts:[{accountId:(request.body.expectedAccounts as {accountId:string}[])[0].accountId,version:2,deductedMinutes:450,remainingMinutes:9550}]},error:null});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
const key=(workspaceId:string,userId:string)=>`rev-annual-leave:${workspaceId}:${userId}`;

describe('Annual Leave mounted scope lifecycle',()=>{
 beforeEach(()=>{window.sessionStorage.clear();mocks.rows.clear();mocks.invoke.mockReset();mocks.range.mockReset();mocks.range.mockImplementation((table:string)=>Promise.resolve({data:mocks.rows.get(table)??[],error:null}));});
 afterEach(()=>{cleanup();window.sessionStorage.clear();});

 it('ignores an original mutation after switching scope and restores each scope without clearing either pending request',async()=>{
  const pendingA=attempt(wsA,workerA,requestA,accountA),pendingB=attempt(wsB,workerB,requestB,accountB),invocation=deferred<ReturnType<typeof success>>(),plannerEvent=vi.fn();
  rememberAnnualLeaveAttempt(window.sessionStorage,userA,pendingA);
  rememberAnnualLeaveAttempt(window.sessionStorage,userB,pendingB);
  mocks.invoke.mockReturnValueOnce(invocation.promise);
  window.addEventListener('rev-scheduling-changed',plannerEvent);
  const view=render(<AnnualLeaveView workspaceId={wsA} userId={userA} workers={[worker(wsA,workerA,'Worker A')]}/>);
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Worker'})).toHaveValue(workerA));
  fireEvent.click(screen.getByRole('button',{name:'Retry same change'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));

  view.rerender(<AnnualLeaveView workspaceId={wsB} userId={userB} workers={[worker(wsB,workerB,'Worker B')]}/>);
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Worker'})).toHaveValue(workerB));
  expect(screen.getByRole('button',{name:'Retry same change'})).toBeEnabled();

  await act(async()=>{invocation.resolve(success(wsA,workerA,pendingA));await invocation.promise;});
  expect(screen.getByRole('combobox',{name:'Worker'})).toHaveValue(workerB);
  expect(screen.getByRole('button',{name:'Retry same change'})).toBeEnabled();
  expect(JSON.parse(window.sessionStorage.getItem(key(wsA,userA))??'null').requestId).toBe(requestA);
  expect(JSON.parse(window.sessionStorage.getItem(key(wsB,userB))??'null').requestId).toBe(requestB);
  expect(plannerEvent).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);

  view.rerender(<AnnualLeaveView workspaceId={wsA} userId={userA} workers={[worker(wsA,workerA,'Worker A')]}/>);
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Worker'})).toHaveValue(workerA));
  expect(screen.getByRole('button',{name:'Retry same change'})).toBeEnabled();
  expect(JSON.parse(window.sessionStorage.getItem(key(wsA,userA))??'null').requestId).toBe(requestA);
  expect(JSON.parse(window.sessionStorage.getItem(key(wsB,userB))??'null').requestId).toBe(requestB);
  window.removeEventListener('rev-scheduling-changed',plannerEvent);
 });

 it('does not clear recovery or dispatch a stale planner event after unmount',async()=>{
  const pendingA=attempt(wsA,workerA,requestA,accountA),invocation=deferred<ReturnType<typeof success>>(),plannerEvent=vi.fn();
  rememberAnnualLeaveAttempt(window.sessionStorage,userA,pendingA);
  mocks.invoke.mockReturnValueOnce(invocation.promise);
  window.addEventListener('rev-scheduling-changed',plannerEvent);
  const view=render(<AnnualLeaveView workspaceId={wsA} userId={userA} workers={[worker(wsA,workerA,'Worker A')]}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Retry same change'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async()=>{invocation.resolve(success(wsA,workerA,pendingA));await invocation.promise;});
  expect(JSON.parse(window.sessionStorage.getItem(key(wsA,userA))??'null').requestId).toBe(requestA);
  expect(plannerEvent).not.toHaveBeenCalled();
  window.removeEventListener('rev-scheduling-changed',plannerEvent);
 });

 it('safely dismisses only a retained blank calendar creation without invoking authority',async()=>{
  const invalid:AnnualLeaveAttempt={operation:'calendar',workspaceId:wsA,workerId:workerA,requestId:requestA,body:{workspaceId:wsA,requestId:requestA,action:'save_calendar',calendarId:null,name:'',regionCode:'GB-ENG',status:'active',expectedVersion:0}};
  rememberAnnualLeaveAttempt(window.sessionStorage,userA,invalid);
  render(<AnnualLeaveView workspaceId={wsA} userId={userA} workers={[worker(wsA,workerA,'Worker A')]}/>);
  const dismiss=await screen.findByRole('button',{name:'Dismiss invalid change'});
  expect(screen.queryByRole('button',{name:'Retry same change'})).not.toBeInTheDocument();
  fireEvent.click(dismiss);
  await screen.findByText('Enter a calendar name.');
  expect(window.sessionStorage.getItem(key(wsA,userA))).toBeNull();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'Dismiss invalid change'})).not.toBeInTheDocument();
 });

 it('keeps setup fields editable while guarding writes and enables each confirmed setup step',async()=>{
  const policyId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',calendarId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const setPolicy=()=>mocks.rows.set('annual_leave_policies',[{id:policyId,workspace_id:wsA,worker_id:workerA,version:1,effective_from_leave_year:2026,allowance_input_unit:'days',allowance_input_value:28,allowance_minutes:12600,hours_per_day_minutes:450,leave_year_start_month:1,leave_year_start_day:1,bank_holiday_treatment:'included'}]);
  const setAccount=()=>mocks.rows.set('annual_leave_accounts',[{id:accountA,workspace_id:wsA,worker_id:workerA,leave_year_start:'2026-01-01',leave_year_end_exclusive:'2027-01-01',configured_allowance_minutes:12600,hours_per_day_minutes:450,bank_holiday_treatment:'included',adjustment_total_minutes:0,recorded_leave_minutes:0,version:1}]);
  const setCalendar=()=>mocks.rows.set('annual_leave_calendars',[{id:calendarId,workspace_id:wsA,name:'England holidays',region_code:'GB-ENG',status:'active',version:1}]);
  mocks.invoke.mockImplementation(async(name:string,{body}:{body:Record<string,unknown>})=>{
   if(name==='rev-annual-leave-policy-save'){setPolicy();return{data:{workspaceId:wsA,workerId:workerA,version:1},error:null};}
   if(name==='rev-annual-leave-account-open'){setAccount();return{data:{workspaceId:wsA,workerId:workerA,leaveYearStart:'2026-01-01',version:1},error:null};}
   if(name==='rev-annual-leave-calendar-configure'&&body.action==='save_calendar'){setCalendar();return{data:{workspaceId:wsA,action:'save_calendar'},error:null};}
   if(name==='rev-annual-leave-calendar-configure'&&body.action==='assign_worker'){mocks.rows.set('annual_leave_worker_calendars',[{workspace_id:wsA,worker_id:workerA,calendar_id:calendarId,version:1}]);return{data:{workspaceId:wsA,action:'assign_worker',workerId:workerA},error:null};}
   throw Error(`Unexpected operation ${name}`);
  });
  render(<AnnualLeaveView workspaceId={wsA} userId={userA} workers={[worker(wsA,workerA,'Worker A')]}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Leave settings'}));

  const allowance=screen.getByRole('spinbutton',{name:'Allowance'});
  const calendarName=screen.getByRole('textbox',{name:'New calendar name'});
  expect(allowance).toBeEnabled();expect(calendarName).toBeEnabled();
  fireEvent.change(allowance,{target:{value:'28'}});
  fireEvent.change(calendarName,{target:{value:'England holidays'}});
  fireEvent.click(screen.getByRole('button',{name:'Save worker leave settings'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Create leave year'})).toBeEnabled());

  fireEvent.click(screen.getByRole('button',{name:'Create leave year'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Create holiday calendar'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Create holiday calendar'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Assign calendar to this worker'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Assign calendar to this worker'}));
  await screen.findByText('Calendar assigned to this worker.');

  expect(allowance).toBeEnabled();expect(calendarName).toBeEnabled();
  expect(mocks.invoke.mock.calls.map(([name])=>name)).toEqual([
   'rev-annual-leave-policy-save',
   'rev-annual-leave-account-open',
   'rev-annual-leave-calendar-configure',
   'rev-annual-leave-calendar-configure',
  ]);
 });

 it('allows draft editing but explains why setup writes stay blocked during exact recovery',async()=>{
  const pendingA=attempt(wsA,workerA,requestA,accountA);
  rememberAnnualLeaveAttempt(window.sessionStorage,userA,pendingA);
  render(<AnnualLeaveView workspaceId={wsA} userId={userA} workers={[worker(wsA,workerA,'Worker A')]}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Leave settings'}));
  const allowance=screen.getByRole('spinbutton',{name:'Allowance'});
  expect(allowance).toBeEnabled();
  fireEvent.change(allowance,{target:{value:'30'}});
  expect(allowance).toHaveValue(30);
  expect(screen.getByRole('button',{name:'Save worker leave settings'})).toBeDisabled();
  expect(screen.getByRole('complementary',{name:'Pending annual leave change'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Retry same change'})).toBeEnabled();
  expect(screen.queryByText('Resolve the saved change with Retry same change before saving another change.')).not.toBeInTheDocument();
  expect(mocks.invoke).not.toHaveBeenCalled();
 });

  it('reactivates after Strict Mode cleanup while invalidating results captured by the prior effect generation',async()=>{
   const pendingA=attempt(wsA,workerA,requestA,accountA),stalePage=deferred<{data:null;error:{message:string}}>();
   rememberAnnualLeaveAttempt(window.sessionStorage,userA,pendingA);
   mocks.range.mockImplementationOnce(()=>stalePage.promise);
   mocks.invoke.mockResolvedValue({data:null,error:new Error('network')});
   render(<StrictMode><AnnualLeaveView workspaceId={wsA} userId={userA} workers={[worker(wsA,workerA,'Worker A')]}/></StrictMode>);

   await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh'})).toBeEnabled());
   expect(screen.queryByText('Loading leave...')).not.toBeInTheDocument();
   const retry=screen.getByRole('button',{name:'Retry same change'});
   expect(retry).toBeEnabled();

   fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
   await screen.findByText('Leave details refreshed. No saved change was resubmitted.');
   expect(screen.getByRole('button',{name:'Refresh'})).toBeEnabled();

   fireEvent.click(retry);
   await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
   await screen.findByText('We could not confirm what happened. Your original change is saved; use Retry same change before doing anything else.');
   expect(screen.getByRole('button',{name:'Retry same change'})).toBeEnabled();

   await act(async()=>{stalePage.resolve({data:null,error:{message:'stale pre-cleanup result'}});await stalePage.promise;});
   expect(screen.queryByText(/No leave changes can be made/)).not.toBeInTheDocument();
   expect(screen.getByRole('button',{name:'Refresh'})).toBeEnabled();
   expect(screen.getByRole('button',{name:'Retry same change'})).toBeEnabled();
  });
});
