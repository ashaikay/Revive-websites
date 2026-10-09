// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {rememberLeaveAttempt,restoreLeaveAttempt,type LeaveAttempt} from '@/services/workerUnavailability';

const workspaceId='11111111-1111-4111-8111-111111111111';
const userId='22222222-2222-4222-8222-222222222222';
const workerId='33333333-3333-4333-8333-333333333333';
const assignmentId='44444444-4444-4444-8444-444444444444';
const jobId='55555555-5555-4555-8555-555555555555';
const recordId='66666666-6666-4666-8666-666666666666';
const karolWorkerId='77777777-7777-4777-8777-777777777777';

const mocks=vi.hoisted(()=>({rows:{} as Record<string,unknown[]>,invoke:vi.fn()}));
vi.mock('@/data/supabaseClient',()=>({
 supabaseClient:{
  from:(table:string)=>{const chain:any={
   select:()=>chain,
   eq:()=>chain,
   then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:mocks.rows[table]??[],error:null}).then(resolve),
  };return chain;},
  functions:{invoke:mocks.invoke},
 },
}));

import {WorkerUnavailabilityPanel} from '@/components/WorkerUnavailabilityPanel';

function renderPanel(){
 return render(<WorkerUnavailabilityPanel workspaceId={workspaceId} userId={userId} workerId={workerId} active workspaceTimezone="Europe/London"/>);
}

async function enterSickness(){
 const summary=screen.getByText('Leave, sickness and unavailable periods');
 fireEvent.click(summary);
 const details=summary.closest('details');
 await waitFor(()=>expect(details).toHaveAttribute('open'));
 const add=await screen.findByRole('button',{name:'ADD UNAVAILABLE / SICKNESS'});
 await waitFor(()=>expect(add).toBeEnabled());
 expect(add).toBeVisible();
 fireEvent.click(add);
 const form=await screen.findByRole('form',{name:'Record unavailable or sickness period'});
 expect(form).toBeVisible();
 expect(details).toHaveAttribute('open');
 fireEvent.change(screen.getByLabelText('Unavailable / Sickness'),{target:{value:'sickness'}});
 fireEvent.change(screen.getByLabelText(/First sickness date/),{target:{value:'2026-10-25'}});
 fireEvent.change(screen.getByLabelText(/Last sickness date/),{target:{value:'2026-10-25'}});
}

describe('Sickness recording UI',()=>{
 beforeEach(()=>{
  window.sessionStorage.clear();
  mocks.rows={scheduling_worker_unavailability:[],annual_leave_absences:[],scheduling_assignments:[]};
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async(_name,{body})=>({data:{unavailabilityId:recordId,workspaceId,workerId,startAt:body.startAt,endAt:body.endAt,category:'sickness',status:'active',version:1},error:null}));
 });
 afterEach(()=>{cleanup();vi.restoreAllMocks();window.sessionStorage.clear();});

 it('opens the visible inline form, records inclusive sickness dates and submits through the mocked boundary',async()=>{
  renderPanel();
  await enterSickness();
  expect(screen.getByLabelText(/First sickness date/)).toHaveAccessibleName(/inclusive/);
  expect(screen.getByLabelText(/Last sickness date/)).toHaveAccessibleName(/inclusive/);
  expect(screen.getByText(/Do not enter diagnoses, symptoms, medical notes/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'SAVE'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
  const [name,{body}]=mocks.invoke.mock.calls[0];
  expect(name).toBe('rev-worker-unavailability-save');
  expect(body).toMatchObject({workspaceId,workerId,startAt:'2026-10-24T23:00:00.000Z',endAt:'2026-10-26T00:00:00.000Z',category:'sickness',status:'active',expectedVersion:0});
  expect(body).not.toHaveProperty('notes');
  expect(body).not.toHaveProperty('diagnosis');
  await screen.findByText(/Sickness dates saved/);
 });

 it('lists overlapping assignments and refuses to save, cancel or reassign them',async()=>{
  mocks.rows.scheduling_assignments=[{id:assignmentId,workspace_id:workspaceId,worker_id:workerId,job_id:jobId,start_at:'2026-10-25T09:00:00.000Z',end_at:'2026-10-25T12:00:00.000Z',status:'active',version:1}];
  renderPanel();
  await enterSickness();
  fireEvent.click(screen.getByRole('button',{name:'SAVE'}));
  await screen.findByText(/Sickness was not saved/);
  expect(screen.getByRole('status')).toHaveTextContent('Affected assignments: Assignment 1:');
  expect(screen.getByRole('status')).toHaveTextContent('REV will not cancel or reassign work');
  expect(mocks.invoke).not.toHaveBeenCalled();
 });

 it('shows a sanitized confirmed rejection beside retry while preserving the exact request',async()=>{
  mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({error:'Invalid unavailable period.'}),{status:400,headers:{'Content-Type':'application/json'}})}});
  renderPanel();
  await enterSickness();
  fireEvent.click(screen.getByRole('button',{name:'SAVE'}));
  const status=await screen.findByRole('status');
  expect(status).toHaveTextContent('Save rejected (HTTP 400): Invalid unavailable period.');
  expect(status).toHaveTextContent('confirmed rejection did not record a period');
  const retry=screen.getByRole('button',{name:'RETRY SAME PERIOD SAVE'});
  expect(retry).toBeEnabled();
  const retained=restoreLeaveAttempt(window.sessionStorage,workspaceId,userId,workerId);
  expect(retained).toMatchObject({workspaceId,workerId,startAt:'2026-10-24T23:00:00.000Z',endAt:'2026-10-26T00:00:00.000Z',category:'sickness',status:'active',expectedVersion:0});
  expect(retained?.requestId).toEqual(expect.any(String));
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });

 it('keeps a server failure unconfirmed without exposing its response body',async()=>{
  mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({error:'private database detail'}),{status:500,headers:{'Content-Type':'application/json'}})}});
  renderPanel();
  await enterSickness();
  fireEvent.click(screen.getByRole('button',{name:'SAVE'}));
  const status=await screen.findByRole('status');
  expect(status).toHaveTextContent('Outcome still unconfirmed.');
  expect(status).not.toHaveTextContent('private database detail');
  expect(screen.getByRole('button',{name:'RETRY SAME PERIOD SAVE'})).toBeEnabled();
  expect(restoreLeaveAttempt(window.sessionStorage,workspaceId,userId,workerId)).not.toBeNull();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });

 it('keeps Annual Leave on its dedicated path and disables sickness when workspace timezone is unavailable',async()=>{
  const {rerender}=renderPanel();
  await screen.findByRole('button',{name:'ADD UNAVAILABLE / SICKNESS'});
  expect(screen.queryByText(/annual-leave balance will be deducted or credited/)).not.toBeInTheDocument();
  rerender(<WorkerUnavailabilityPanel workspaceId={workspaceId} userId={userId} workerId={workerId} active workspaceTimezone={null}/>);
  fireEvent.click(screen.getByText('Leave, sickness and unavailable periods'));
  fireEvent.click(await screen.findByRole('button',{name:'ADD UNAVAILABLE / SICKNESS'}));
  expect(screen.getByRole('option',{name:'Sickness'})).toBeDisabled();
  expect(screen.getByText(/workspace timezone could not be confirmed/)).toBeInTheDocument();
 });

 it('retains generic unavailable time fields, visible validation, and explicit discard',async()=>{
  renderPanel();
  const summary=screen.getByText('Leave, sickness and unavailable periods');
  fireEvent.click(summary);
  fireEvent.click(await screen.findByRole('button',{name:'ADD UNAVAILABLE / SICKNESS'}));
  const form=await screen.findByRole('form',{name:'Record unavailable or sickness period'});
  expect(form).toBeVisible();
  expect(screen.getByLabelText('Unavailable / Sickness')).toHaveValue('unavailable');
  expect(screen.getByLabelText(/Start \(Europe\/London\)/)).toHaveAttribute('type','datetime-local');
  expect(screen.getByLabelText(/End \(Europe\/London\)/)).toHaveAttribute('type','datetime-local');
  fireEvent.click(screen.getByRole('button',{name:'SAVE'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Enter both the unavailable start and end times.');
  expect(mocks.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'DISCARD CHANGES'}));
  expect(screen.queryByRole('form',{name:'Record unavailable or sickness period'})).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Changes discarded. No unavailable or sickness period was changed.');
 });

 it('preserves Ricki and Karol unconfirmed payloads and exposes only their retry controls',async()=>{
  const ricki:LeaveAttempt={workspaceId,workerId,requestId:userId,unavailabilityId:null,startAt:'2026-10-24T23:00:00.000Z',endAt:'2026-10-26T00:00:00.000Z',category:'sickness',status:'active',expectedVersion:0};
  const karol:LeaveAttempt={workspaceId,workerId:karolWorkerId,requestId:recordId,unavailabilityId:null,startAt:'2026-10-27T09:00:00.000Z',endAt:'2026-10-27T17:00:00.000Z',category:'unavailable',status:'active',expectedVersion:0};
  rememberLeaveAttempt(window.sessionStorage,userId,ricki);
  rememberLeaveAttempt(window.sessionStorage,userId,karol);
  render(<><WorkerUnavailabilityPanel workspaceId={workspaceId} userId={userId} workerId={workerId} active workspaceTimezone="Europe/London"/><WorkerUnavailabilityPanel workspaceId={workspaceId} userId={userId} workerId={karolWorkerId} active workspaceTimezone="Europe/London"/></>);
  expect((await screen.findAllByRole('button',{name:'RETRY SAME PERIOD SAVE'}))).toHaveLength(2);
  for(const add of screen.getAllByRole('button',{name:'ADD UNAVAILABLE / SICKNESS',hidden:true})){expect(add).toBeDisabled();fireEvent.click(add);}
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(restoreLeaveAttempt(window.sessionStorage,workspaceId,userId,workerId)).toEqual(ricki);
  expect(restoreLeaveAttempt(window.sessionStorage,workspaceId,userId,karolWorkerId)).toEqual(karol);
  expect(mocks.invoke).not.toHaveBeenCalled();
 });
});
