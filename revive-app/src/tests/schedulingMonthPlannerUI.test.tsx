// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const workspaceId='11111111-1111-4111-8111-111111111111';
const workerId='22222222-2222-4222-8222-222222222222';
const jobId='33333333-3333-4333-8333-333333333333';
const assignmentId='44444444-4444-4444-8444-444444444444';
const patternId='55555555-5555-4555-8555-555555555555';
const leaveId='66666666-6666-4666-8666-666666666666';
const sicknessId='77777777-7777-4777-8777-777777777777';
const unavailableId='88888888-8888-4888-8888-888888888888';

const mocks=vi.hoisted(()=>({rows:{} as Record<string,unknown[]>}));
vi.mock('@/data/supabaseClient',()=>({
 supabaseClient:{
  from:(table:string)=>{const chain={
   select:()=>chain,
   eq:()=>chain,
   order:()=>chain,
   range:async()=>({data:mocks.rows[table]??[],error:null}),
  };return chain;},
 },
}));

import {SchedulingWeeklyPlanner} from '@/components/SchedulingWeeklyPlanner';

describe('Full-width scheduling month planner',()=>{
 beforeEach(()=>{
  mocks.rows={
   scheduling_workers:[{id:workerId,workspace_id:workspaceId,display_name:'Ricki',role_labels:[],skill_tags:['Fire'],active:true,version:1}],
   scheduling_jobs:[{id:jobId,workspace_id:workspaceId,title:'October inspection',start_at:'2026-10-09T08:00:00.000Z',end_at:'2026-10-09T11:00:00.000Z',timezone:'Europe/London',location:'Walsall',required_skills:['Fire'],skill_requirement_mode:'all',staffing_count:2,status:'open',version:1}],
   scheduling_assignments:[{id:assignmentId,workspace_id:workspaceId,worker_id:workerId,job_id:jobId,start_at:'2026-10-09T08:00:00.000Z',end_at:'2026-10-09T11:00:00.000Z',status:'active',version:1}],
   scheduling_worker_patterns:[{id:patternId,workspace_id:workspaceId,worker_id:workerId,timezone:'Europe/London',working_days:[1,2,3,4,5],start_local:'09:00',end_local:'17:00',effective_from:'2026-01-01',effective_until:null,version:1}],
   scheduling_worker_unavailability:[
    {id:leaveId,workspace_id:workspaceId,worker_id:workerId,start_at:'2026-10-09T00:00:00.000Z',end_at:'2026-10-09T07:00:00.000Z',category:'leave',status:'active',version:1},
    {id:sicknessId,workspace_id:workspaceId,worker_id:workerId,start_at:'2026-10-08T23:00:00.000Z',end_at:'2026-10-09T23:00:00.000Z',category:'sickness',status:'active',version:1},
    {id:unavailableId,workspace_id:workspaceId,worker_id:workerId,start_at:'2026-10-09T12:00:00.000Z',end_at:'2026-10-09T14:00:00.000Z',category:'unavailable',status:'active',version:1},
   ],
  };
 });
 afterEach(()=>{cleanup();vi.restoreAllMocks();});

 it('keeps Week as default and shares date, timezone and filters with the accessible month view',async()=>{
  render(<SchedulingWeeklyPlanner workspaceId={workspaceId}/>);
  await screen.findByText('Weekly planner');
  expect(screen.getByRole('button',{name:'WEEK'})).toHaveAttribute('aria-pressed','true');
  fireEvent.change(screen.getByLabelText('Week beginning'),{target:{value:'2026-10-05'}});
  fireEvent.change(screen.getByLabelText('Display timezone'),{target:{value:'UTC'}});
  fireEvent.change(screen.getByLabelText('Worker'),{target:{value:workerId}});
  fireEvent.change(screen.getByLabelText('Location'),{target:{value:'Walsall'}});
  fireEvent.click(screen.getByRole('button',{name:'MONTH'}));
  expect(screen.getByRole('button',{name:'MONTH'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('heading',{name:'October 2026'})).toBeInTheDocument();
  expect(screen.getByLabelText('Display timezone')).toHaveValue('UTC');
  expect(screen.getByLabelText('Worker')).toHaveValue(workerId);
  expect(screen.getByLabelText('Location')).toHaveValue('Walsall');
  expect(screen.getByRole('button',{name:'Previous month'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Next month'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Today'})).toBeInTheDocument();
  const planner=screen.getByLabelText('October 2026 month planner');
  const headings=within(planner).getAllByText(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/);
  expect(headings[0]).toHaveTextContent('Monday');
  expect(within(planner).getAllByText('Sickness').length).toBeGreaterThan(0);
  const overflow=within(planner).getByText('More entries (2)');
  fireEvent.click(overflow);
  expect(overflow.closest('details')).toHaveAttribute('open');
 });

 it('navigates across month and year boundaries while retaining the selected view',async()=>{
  render(<SchedulingWeeklyPlanner workspaceId={workspaceId}/>);
  await screen.findByText('Weekly planner');
  fireEvent.click(screen.getByRole('button',{name:'MONTH'}));
  fireEvent.change(screen.getByLabelText('Month containing'),{target:{value:'2026-12-15'}});
  expect(screen.getByRole('heading',{name:'December 2026'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Next month'}));
  expect(screen.getByRole('heading',{name:'January 2027'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Previous month'}));
  expect(screen.getByRole('heading',{name:'December 2026'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'WEEK'}));
  expect(screen.getByLabelText('Week beginning')).toHaveValue('2026-11-30');
 });

 it('retains the last successful month and reports stale refresh failures',async()=>{
  render(<SchedulingWeeklyPlanner workspaceId={workspaceId}/>);
  await screen.findByText('Weekly planner');
  fireEvent.click(screen.getByRole('button',{name:'MONTH'}));
  fireEvent.change(screen.getByLabelText('Month containing'),{target:{value:'2026-10-09'}});
  mocks.rows.scheduling_jobs=undefined as unknown as unknown[];
  const original=mocks.rows;
  mocks.rows=new Proxy(original,{get(target,key){if(key==='scheduling_jobs')throw new Error('Unavailable');return Reflect.get(target,key);}});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'REFRESH PLANNER'}));});
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('last successful view'));
  expect(screen.getByLabelText('October 2026 month planner')).toBeInTheDocument();
 });
});
