// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {SchedulingJob} from '@/services/schedulingJobs';

type DbRow=Record<string,unknown>;
const mocks=vi.hoisted(()=>({db:{} as Record<string,DbRow[]>,invoke:vi.fn()}));
// Minimal in-memory query builder so the real worker, assignment and planner loaders run unchanged.
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{functions:{invoke:mocks.invoke},from:(table:string)=>{
 let columns:string[]=[],range:[number,number]|null=null;const filters:[string,unknown][]=[];
 const run=()=>{let rows=(mocks.db[table]??[]).filter(row=>filters.every(([column,value])=>row[column]===value));if(range)rows=rows.slice(range[0],range[1]+1);return{data:rows.map(row=>Object.fromEntries(columns.map(column=>[column,structuredClone(row[column])]))),error:null};};
 const query={select:(value:string)=>{columns=value.split(',');return query;},eq:(column:string,value:unknown)=>{filters.push([column,value]);return query;},order:()=>query,range:(from:number,to:number)=>{range=[from,to];return query;},then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve(run()).then(resolve,reject)};
 return query;}}}));

import {JobAssignmentsPanel} from '@/components/JobAssignmentsPanel';

const ws='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const otherJobId='33333333-3333-4333-8333-333333333331',assignedJobId='33333333-3333-4333-8333-333333333332';
const karol='44444444-4444-4444-8444-444444444441',tom='44444444-4444-4444-8444-444444444442',karolAssignment='55555555-5555-4555-8555-555555555551';
const startAt='2026-11-13T10:00:00.000Z',endAt='2026-11-13T15:00:00.000Z',skill='Dsear & Fire';
const job=(jobId:string,title:string):SchedulingJob=>({jobId,workspaceId:ws,title,startAt,endAt,timezone:'Europe/London',location:'Cardiff',requiredSkills:[skill],staffingCount:1,status:'open',version:1});
const otherJob=job(otherJobId,'Other job'),assignedJob=job(assignedJobId,'assigned job');
const workerRow=(id:string,name:string,skills:string[])=>({id,workspace_id:ws,display_name:name,role_labels:[],skill_tags:skills,active:true,version:1});
const jobRow=(j:SchedulingJob)=>({id:j.jobId,workspace_id:ws,title:j.title,start_at:j.startAt,end_at:j.endAt,timezone:j.timezone,location:j.location,required_skills:j.requiredSkills,staffing_count:1,status:'open',version:1});
const hours=(id:string,workerId:string)=>({id,workspace_id:ws,worker_id:workerId,timezone:'Europe/London',working_days:[1,2,3,4,5,6,7],start_local:'09:00',end_local:'17:00',effective_from:'2026-10-01',effective_until:null,version:1});
function seed({karolSkills=[skill],tomHours=true,karolBooked=true}:{karolSkills?:string[];tomHours?:boolean;karolBooked?:boolean}={}){
 mocks.db={
  scheduling_workers:[workerRow(karol,'Karol',karolSkills),workerRow(tom,'Tom',[skill])],
  scheduling_jobs:[jobRow(otherJob),jobRow(assignedJob)],
  scheduling_assignments:karolBooked?[{id:karolAssignment,workspace_id:ws,worker_id:karol,job_id:otherJobId,start_at:startAt,end_at:endAt,status:'active',version:1}]:[],
  scheduling_worker_patterns:[hours('66666666-6666-4666-8666-666666666661',karol),...(tomHours?[hours('66666666-6666-4666-8666-666666666662',tom)]:[])],
  scheduling_worker_unavailability:[],
 };
}
const panel=(title:string)=>screen.getByRole('article',{name:`${title} job`});
const guidance=(title:string)=>panel(title).querySelector('[aria-label="Worker suitability guidance"]') as HTMLElement;
const reasonFor=(title:string,name:string)=>within(guidance(title)).getByText(name).nextElementSibling?.textContent;
const options=(title:string)=>within(within(panel(title)).getByRole('combobox',{name:'Choose a worker'})).queryAllByRole('option').map(option=>option.textContent);

beforeEach(()=>{mocks.invoke.mockReset();HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{cleanup();window.sessionStorage.clear();vi.restoreAllMocks();});

describe('worker suitability stays current across panels',()=>{
 it('after a confirmed cancellation on another job, the worker becomes selectable on the overlapping job',async()=>{
  seed();
  render(<><JobAssignmentsPanel workspaceId={ws} userId={userId} job={otherJob}/><JobAssignmentsPanel workspaceId={ws} userId={userId} job={assignedJob}/></>);
  await waitFor(()=>expect(reasonFor('assigned job','Karol')).toBe('Already booked'));
  expect(reasonFor('assigned job','Tom')).toBe('Available');
  expect(options('assigned job')).toEqual(['Choose worker','Tom']);
  expect(guidance('assigned job').closest('details')).not.toHaveAttribute('open');

  mocks.invoke.mockImplementationOnce(async()=>{
   mocks.db.scheduling_assignments=[{...mocks.db.scheduling_assignments[0],status:'cancelled',version:2}];
   return{data:{assignmentId:karolAssignment,workspaceId:ws,workerId:karol,jobId:otherJobId,startAt,endAt,status:'cancelled',version:2},error:null};
  });
  fireEvent.click(within(panel('Other job')).getByRole('button',{name:'Cancel assignment'}));
  fireEvent.click(within(panel('Other job')).getByRole('button',{name:'Confirm cancellation'}));
  expect(await within(panel('Other job')).findByText(/Karol’s assignment was cancelled\. 0 of 1 places filled\./)).toBeInTheDocument();

  await waitFor(()=>expect(reasonFor('assigned job','Karol')).toBe('Available'));
  expect(options('assigned job')).toEqual(['Choose worker','Karol','Tom']);
  const select=within(panel('assigned job')).getByRole('combobox',{name:'Choose a worker'});
  fireEvent.change(select,{target:{value:karol}});
  expect(within(panel('assigned job')).getByRole('button',{name:'Assign worker'})).toBeEnabled();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });

 it('a worker skill saved elsewhere on the page refreshes the allocation without a manual refresh',async()=>{
  seed({karolSkills:['Fire'],karolBooked:false});
  render(<JobAssignmentsPanel workspaceId={ws} userId={userId} job={assignedJob}/>);
  await waitFor(()=>expect(reasonFor('assigned job','Karol')).toBe('Required skill not listed: Dsear & Fire'));
  mocks.db.scheduling_workers[0]={...mocks.db.scheduling_workers[0],skill_tags:['Fire',skill],version:2};
  await act(async()=>{window.dispatchEvent(new Event('rev-scheduling-changed'));});
  await waitFor(()=>expect(reasonFor('assigned job','Karol')).toBe('Available'));
  expect(options('assigned job')).toContain('Karol');
 });

 it('treats capitalisation and repeated spaces as the same skill but keeps the saved label',async()=>{
  seed({karolSkills:['dsear  &  FIRE'],karolBooked:false});
  render(<JobAssignmentsPanel workspaceId={ws} userId={userId} job={assignedJob}/>);
  await waitFor(()=>expect(reasonFor('assigned job','Karol')).toBe('Available'));
  expect(options('assigned job')).toEqual(['Choose worker','Karol','Tom']);
  expect(within(guidance('assigned job')).getByText('Required skills: Dsear & Fire')).toBeInTheDocument();
 });

 it('names the exact missing tag when a skill truly differs and explains when no one is available',async()=>{
  seed({karolSkills:['DSEAR\u00a0&  fire'],tomHours:false,karolBooked:false});
  render(<JobAssignmentsPanel workspaceId={ws} userId={userId} job={assignedJob}/>);
  await waitFor(()=>expect(reasonFor('assigned job','Karol')).toBe('Required skill not listed: Dsear & Fire. A similar skill is saved with different spelling or spacing; edit the worker’s skills to match exactly.'));
  expect(reasonFor('assigned job','Tom')).toBe('No working hours set');
  expect(options('assigned job')).toEqual(['Choose worker']);
  expect(screen.getAllByText('No available workers for this shift. Check the reasons below or adjust the shift.')).toHaveLength(1);
  expect(within(panel('assigned job')).getByRole('button',{name:'Assign worker'})).toBeDisabled();
 });
});
