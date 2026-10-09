// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const workspaceId='11111111-1111-4111-8111-111111111111';
const userId='22222222-2222-4222-8222-222222222222';
const workerId='33333333-3333-4333-8333-333333333333';
const jobId='44444444-4444-4444-8444-444444444444';
const assignmentId='55555555-5555-4555-8555-555555555555';

const mocks=vi.hoisted(()=>({
 rows:{} as Record<string,unknown[]>,
 invoke:vi.fn(),
}));

vi.mock('@/data/supabaseClient',()=>({
 supabaseClient:{
  from:(table:string)=>{const chain={
   select:()=>chain,
   eq:()=>chain,
   order:()=>chain,
   range:async()=>({data:mocks.rows[table]??[],error:null}),
  };return chain;},
  functions:{invoke:mocks.invoke},
 },
}));

import {SchedulingWeeklyPlanner} from '@/components/SchedulingWeeklyPlanner';

function successfulResponse(body:Record<string,unknown>){
 return{
  workspaceId:body.workspaceId,
  workerId:body.workerId,
  unavailabilityId:'66666666-6666-4666-8666-666666666666',
  startAt:body.startAt,
  endAt:body.endAt,
  category:body.category,
  status:body.status,
  version:1,
 };
}

async function openDay(day='25/10/2026'){
 render(<SchedulingWeeklyPlanner workspaceId={workspaceId} userId={userId} workspaceTimezone="Europe/London"/>);
 await screen.findByText('Weekly planner');
 fireEvent.change(screen.getByLabelText('Week beginning'),{target:{value:'2026-10-19'}});
 fireEvent.click(screen.getByRole('button',{name:`Book worker off ${day}`}));
}

describe('Week planner Book worker off',()=>{
 beforeEach(()=>{
  window.sessionStorage.clear();
  mocks.invoke.mockReset();
  mocks.rows={
   scheduling_workers:[{id:workerId,workspace_id:workspaceId,display_name:'Ricki',role_labels:[],skill_tags:[],active:true,version:1}],
   scheduling_jobs:[],
   scheduling_assignments:[],
   scheduling_worker_patterns:[],
   scheduling_worker_unavailability:[],
  };
 });
 afterEach(()=>{cleanup();vi.restoreAllMocks();});

 it('saves a DST-safe Generic Unavailable local day without Annual Leave or provider actions',async()=>{
  mocks.invoke.mockImplementation(async(_name:string,{body}:{body:Record<string,unknown>})=>({data:successfulResponse(body),error:null}));
  await openDay();
  expect(screen.getByLabelText('Worker to book off')).toHaveValue(workerId);
  fireEvent.click(screen.getByRole('button',{name:'SAVE UNAVAILABLE DAY'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledOnce());
  const [name,request]=mocks.invoke.mock.calls[0] as [string,{body:Record<string,unknown>}];
  expect(name).toBe('rev-worker-unavailability-save');
  expect(request.body).toMatchObject({
   workspaceId,workerId,unavailabilityId:null,category:'unavailable',status:'active',expectedVersion:0,
   startAt:'2026-10-24T23:00:00.000Z',
   endAt:'2026-10-26T00:00:00.000Z',
  });
  expect(request.body).not.toHaveProperty('diagnosis');
  expect(request.body).not.toHaveProperty('annualLeave');
  expect(await screen.findByText(/Annual Leave balances were not changed and no notification was sent/)).toBeVisible();
 });

 it('lists assignment conflicts and does not cancel, reassign or invoke a save',async()=>{
  mocks.rows.scheduling_jobs=[{id:jobId,workspace_id:workspaceId,title:'Customer visit',start_at:'2026-10-25T10:00:00.000Z',end_at:'2026-10-25T12:00:00.000Z',timezone:'Europe/London',location:'Site',required_skills:[],skill_requirement_mode:'all',staffing_count:1,status:'open',version:1}];
  mocks.rows.scheduling_assignments=[{id:assignmentId,workspace_id:workspaceId,worker_id:workerId,job_id:jobId,start_at:'2026-10-25T10:00:00.000Z',end_at:'2026-10-25T12:00:00.000Z',status:'active',version:1}];
  await openDay();
  fireEvent.click(screen.getByRole('button',{name:'SAVE UNAVAILABLE DAY'}));
  expect(await screen.findByText(/Ricki is assigned to “Customer visit”/)).toHaveTextContent('Nothing was cancelled or reassigned');
  expect(mocks.invoke).not.toHaveBeenCalled();
 });

 it('retains an uncertain request exactly and retries the same request ID and payload',async()=>{
  mocks.invoke
   .mockResolvedValueOnce({data:null,error:new Error('network')})
   .mockImplementationOnce(async(_name:string,{body}:{body:Record<string,unknown>})=>({data:successfulResponse(body),error:null}));
  await openDay();
  fireEvent.click(screen.getByRole('button',{name:'SAVE UNAVAILABLE DAY'}));
  const retry=await screen.findByRole('button',{name:'RETRY SAME BOOK-OFF REQUEST'});
  const retained=JSON.parse(window.sessionStorage.getItem(`rev-worker-leave:${workspaceId}:${userId}:${workerId}`)??'null');
  expect(retained).toEqual(mocks.invoke.mock.calls[0][1].body);
  fireEvent.click(retry);
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(2));
  expect(mocks.invoke.mock.calls[1][1].body).toEqual(mocks.invoke.mock.calls[0][1].body);
  await waitFor(()=>expect(window.sessionStorage.getItem(`rev-worker-leave:${workspaceId}:${userId}:${workerId}`)).toBeNull());
 });

 it('does not overwrite another retained unavailable or sickness request for the worker',async()=>{
  const retained={workspaceId,workerId,requestId:'77777777-7777-4777-8777-777777777777',unavailabilityId:null,startAt:'2026-10-26T00:00:00.000Z',endAt:'2026-10-27T00:00:00.000Z',category:'sickness',status:'active',expectedVersion:0};
  const key=`rev-worker-leave:${workspaceId}:${userId}:${workerId}`;
  window.sessionStorage.setItem(key,JSON.stringify(retained));
  await openDay();
  fireEvent.click(screen.getByRole('button',{name:'SAVE UNAVAILABLE DAY'}));
  expect(await screen.findByText(/already has an unconfirmed unavailable or sickness request/)).toBeVisible();
  expect(JSON.parse(window.sessionStorage.getItem(key)??'null')).toEqual(retained);
  expect(mocks.invoke).not.toHaveBeenCalled();
 });

 it('discards the visible form without writing a record',async()=>{
  await openDay();
  fireEvent.click(screen.getByRole('button',{name:'DISCARD CHANGES'}));
  expect(screen.queryByRole('button',{name:'SAVE UNAVAILABLE DAY'})).toBeNull();
  expect(screen.getByText('Changes discarded. No unavailable period was created.')).toBeVisible();
  expect(mocks.invoke).not.toHaveBeenCalled();
 });
});
