// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const workspaceId='11111111-1111-4111-8111-111111111111';
const userId='22222222-2222-4222-8222-222222222222';
const workerId='33333333-3333-4333-8333-333333333333';
const assignmentId='44444444-4444-4444-8444-444444444444';
const jobId='55555555-5555-4555-8555-555555555555';
const recordId='66666666-6666-4666-8666-666666666666';

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
 const add=await screen.findByRole('button',{name:'ADD UNAVAILABLE / SICKNESS'});
 await waitFor(()=>expect(add).toBeEnabled());
 fireEvent.click(add);
 fireEvent.change(screen.getByLabelText('Category'),{target:{value:'sickness'}});
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

 it('records inclusive sickness dates as a DST-safe half-open interval without health details',async()=>{
  renderPanel();
  await enterSickness();
  expect(screen.getByText(/Do not enter diagnoses, symptoms, medical notes/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'SAVE PERIOD'}));
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
  fireEvent.click(screen.getByRole('button',{name:'SAVE PERIOD'}));
  await screen.findByText(/Sickness was not saved/);
  expect(screen.getByRole('status')).toHaveTextContent('Affected assignments: Assignment 1:');
  expect(screen.getByRole('status')).toHaveTextContent('REV will not cancel or reassign work');
  expect(mocks.invoke).not.toHaveBeenCalled();
 });

 it('keeps Annual Leave on its dedicated path and disables sickness when workspace timezone is unavailable',async()=>{
  const {rerender}=renderPanel();
  await screen.findByRole('button',{name:'ADD UNAVAILABLE / SICKNESS'});
  expect(screen.queryByText(/annual-leave balance will be deducted or credited/)).not.toBeInTheDocument();
  rerender(<WorkerUnavailabilityPanel workspaceId={workspaceId} userId={userId} workerId={workerId} active workspaceTimezone={null}/>);
  fireEvent.click(await screen.findByRole('button',{name:'ADD UNAVAILABLE / SICKNESS'}));
  expect(screen.getByRole('option',{name:'Sickness'})).toBeDisabled();
  expect(screen.getByText(/workspace timezone could not be confirmed/)).toBeInTheDocument();
 });
});
