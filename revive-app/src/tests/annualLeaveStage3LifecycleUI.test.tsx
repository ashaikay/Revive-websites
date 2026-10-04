// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {AnnualLeaveAttempt} from '@/services/annualLeave';
import type {Worker} from '@/services/schedulingWorkers';

const mocks=vi.hoisted(()=>({invoke:vi.fn(),range:vi.fn()}));
vi.mock('@/data/supabaseClient',()=>{
 const query:{select:(value:string)=>typeof query;eq:(key:string,value:unknown)=>typeof query;or:(value:string)=>typeof query;in:(key:string,value:unknown[])=>typeof query;order:(column:string,options:unknown)=>typeof query;range:(from:number,to:number)=>unknown}={select:()=>query,eq:()=>query,or:()=>query,in:()=>query,order:()=>query,range:(from,to)=>mocks.range(from,to)};
 return{supabaseClient:{functions:{invoke:mocks.invoke},from:()=>query}};
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
 beforeEach(()=>{window.sessionStorage.clear();mocks.invoke.mockReset();mocks.range.mockReset();mocks.range.mockResolvedValue({data:[],error:null});});
 afterEach(()=>{cleanup();window.sessionStorage.clear();});

 it('ignores an original mutation after switching scope and restores each scope without clearing either pending request',async()=>{
  const pendingA=attempt(wsA,workerA,requestA,accountA),pendingB=attempt(wsB,workerB,requestB,accountB),invocation=deferred<ReturnType<typeof success>>(),plannerEvent=vi.fn();
  rememberAnnualLeaveAttempt(window.sessionStorage,userA,pendingA);
  rememberAnnualLeaveAttempt(window.sessionStorage,userB,pendingB);
  mocks.invoke.mockReturnValueOnce(invocation.promise);
  window.addEventListener('rev-scheduling-changed',plannerEvent);
  const view=render(<AnnualLeaveView workspaceId={wsA} userId={userA} workers={[worker(wsA,workerA,'Worker A')]}/>);
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Worker'})).toHaveValue(workerA));
  fireEvent.click(screen.getByRole('button',{name:'RETRY SAME ANNUAL LEAVE CHANGE'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));

  view.rerender(<AnnualLeaveView workspaceId={wsB} userId={userB} workers={[worker(wsB,workerB,'Worker B')]}/>);
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Worker'})).toHaveValue(workerB));
  expect(screen.getByRole('button',{name:'RETRY SAME ANNUAL LEAVE CHANGE'})).toBeEnabled();

  await act(async()=>{invocation.resolve(success(wsA,workerA,pendingA));await invocation.promise;});
  expect(screen.getByRole('combobox',{name:'Worker'})).toHaveValue(workerB);
  expect(screen.getByRole('button',{name:'RETRY SAME ANNUAL LEAVE CHANGE'})).toBeEnabled();
  expect(JSON.parse(window.sessionStorage.getItem(key(wsA,userA))??'null').requestId).toBe(requestA);
  expect(JSON.parse(window.sessionStorage.getItem(key(wsB,userB))??'null').requestId).toBe(requestB);
  expect(plannerEvent).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);

  view.rerender(<AnnualLeaveView workspaceId={wsA} userId={userA} workers={[worker(wsA,workerA,'Worker A')]}/>);
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Worker'})).toHaveValue(workerA));
  expect(screen.getByRole('button',{name:'RETRY SAME ANNUAL LEAVE CHANGE'})).toBeEnabled();
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
  fireEvent.click(await screen.findByRole('button',{name:'RETRY SAME ANNUAL LEAVE CHANGE'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async()=>{invocation.resolve(success(wsA,workerA,pendingA));await invocation.promise;});
  expect(JSON.parse(window.sessionStorage.getItem(key(wsA,userA))??'null').requestId).toBe(requestA);
  expect(plannerEvent).not.toHaveBeenCalled();
  window.removeEventListener('rev-scheduling-changed',plannerEvent);
 });

  it('reactivates after Strict Mode cleanup while invalidating results captured by the prior effect generation',async()=>{
   const pendingA=attempt(wsA,workerA,requestA,accountA),stalePage=deferred<{data:null;error:{message:string}}>();
   rememberAnnualLeaveAttempt(window.sessionStorage,userA,pendingA);
   mocks.range.mockImplementationOnce(()=>stalePage.promise);
   mocks.invoke.mockResolvedValue({data:null,error:new Error('network')});
   render(<StrictMode><AnnualLeaveView workspaceId={wsA} userId={userA} workers={[worker(wsA,workerA,'Worker A')]}/></StrictMode>);

   await waitFor(()=>expect(screen.getByRole('button',{name:'REFRESH AUTHORITATIVE LEAVE DATA'})).toBeEnabled());
   expect(screen.queryByText('Loading authoritative annual leave records...')).not.toBeInTheDocument();
   const retry=screen.getByRole('button',{name:'RETRY SAME ANNUAL LEAVE CHANGE'});
   expect(retry).toBeEnabled();

   fireEvent.click(screen.getByRole('button',{name:'REFRESH AUTHORITATIVE LEAVE DATA'}));
   await screen.findByText('Authoritative annual leave records refreshed. No pending request was submitted.');
   expect(screen.getByRole('button',{name:'REFRESH AUTHORITATIVE LEAVE DATA'})).toBeEnabled();

   fireEvent.click(retry);
   await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
   await screen.findByText('Outcome unknown. The exact request ID and payload are retained; use RETRY SAME ANNUAL LEAVE CHANGE.');
   expect(screen.getByRole('button',{name:'RETRY SAME ANNUAL LEAVE CHANGE'})).toBeEnabled();

   await act(async()=>{stalePage.resolve({data:null,error:{message:'stale pre-cleanup result'}});await stalePage.promise;});
   expect(screen.queryByText(/No leave change can be submitted/)).not.toBeInTheDocument();
   expect(screen.getByRole('button',{name:'REFRESH AUTHORITATIVE LEAVE DATA'})).toBeEnabled();
   expect(screen.getByRole('button',{name:'RETRY SAME ANNUAL LEAVE CHANGE'})).toBeEnabled();
  });
});
