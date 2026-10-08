// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

type DbRow=Record<string,unknown>;
const mocks=vi.hoisted(()=>({db:{} as Record<string,DbRow[]>,invoke:vi.fn()}));
// Minimal in-memory query builder so the real job, worker, assignment and planner loaders run unchanged.
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{functions:{invoke:mocks.invoke},from:(table:string)=>{
 let columns:string[]=[],range:[number,number]|null=null;const filters:[string,unknown][]=[];
 const run=()=>{let rows=(mocks.db[table]??[]).filter(row=>filters.every(([column,value])=>row[column]===value));if(range)rows=rows.slice(range[0],range[1]+1);return{data:rows.map(row=>Object.fromEntries(columns.map(column=>[column,structuredClone(row[column])]))),error:null};};
 const query={select:(value:string)=>{columns=value.split(',');return query;},eq:(column:string,value:unknown)=>{filters.push([column,value]);return query;},order:()=>query,range:(from:number,to:number)=>{range=[from,to];return query;},then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve(run()).then(resolve,reject)};
 return query;}}}));

import {SchedulingJobsPanel} from '@/components/SchedulingJobsPanel';

const ws='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const assignedJobId='33333333-3333-4333-8333-333333333331',overlapJobId='33333333-3333-4333-8333-333333333332';
const harrison='44444444-4444-4444-8444-444444444441',assignmentId='55555555-5555-4555-8555-555555555551',requestId='77777777-7777-4777-8777-777777777771';
const startAt='2026-10-08T10:00:00.000Z',endAt='2026-10-08T14:30:00.000Z',storageKey=`rev-job-save:${ws}:${userId}`;
const jobRow=(id:string,title:string)=>({id,workspace_id:ws,title,start_at:startAt,end_at:endAt,timezone:'Europe/London',location:'Cardiff',required_skills:[],staffing_count:1,status:'open',version:1});
// Exactly the request the browser retained when the earlier cancellation was not confirmed.
const retained={workspaceId:ws,requestId,jobId:assignedJobId,title:'assigned job',startAt,endAt,timezone:'Europe/London',location:'Cardiff',requiredSkills:[],staffingCount:1,status:'cancelled',expectedVersion:1};
const refusal=(id=requestId)=>({data:null,error:{name:'FunctionsHttpError',context:new Response(JSON.stringify({status:'refused',code:'active_assignments',requestId:id}),{status:409})}});

function seed(){
 mocks.db={
  scheduling_jobs:[jobRow(assignedJobId,'assigned job'),jobRow(overlapJobId,'Overlapping job')],
  scheduling_workers:[{id:harrison,workspace_id:ws,display_name:'Harrison',role_labels:[],skill_tags:[],active:true,version:1}],
  scheduling_assignments:[{id:assignmentId,workspace_id:ws,worker_id:harrison,job_id:assignedJobId,start_at:startAt,end_at:endAt,status:'active',version:1}],
  scheduling_worker_patterns:[{id:'66666666-6666-4666-8666-666666666661',workspace_id:ws,worker_id:harrison,timezone:'Europe/London',working_days:[1,2,3,4,5,6,7],start_local:'08:00',end_local:'18:00',effective_from:'2026-10-01',effective_until:null,version:1}],
  scheduling_worker_unavailability:[],
 };
 window.sessionStorage.setItem(storageKey,JSON.stringify(retained));
}
const card=(title:string)=>screen.getByRole('article',{name:`${title} job`});
const expand=(title:string)=>{const toggle=within(card(title)).queryByRole('button',{name:'Show worker allocation'});if(toggle)fireEvent.click(toggle);};
const reasonFor=(title:string,name:string)=>{const guidance=card(title).querySelector('[aria-label="Worker suitability guidance"]') as HTMLElement|null;return guidance?within(guidance).queryByText(name)?.nextElementSibling?.textContent:undefined;};
const pausedText='Worker changes are paused because cancelling this job is not confirmed yet. Select “Retry job cancellation”. If the job still has assigned workers, Revive will say so and this will become available.';

beforeEach(()=>{mocks.invoke.mockReset();HTMLElement.prototype.scrollIntoView=vi.fn();seed();});
afterEach(()=>{cleanup();window.sessionStorage.clear();vi.restoreAllMocks();});

describe('cancelling a job that still has an assigned worker',()=>{
 it('retries a legacy retained cancellation without adding skillRequirementMode',async()=>{
  render(<SchedulingJobsPanel workspaceId={ws} userId={userId}/>);
  const retry=await retryButton();
  mocks.invoke.mockResolvedValueOnce({data:null,error:{name:'FunctionsFetchError',context:new TypeError('Failed to fetch')}});
  fireEvent.click(retry);
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
  const [name,options]=mocks.invoke.mock.calls[0];
  expect(name).toBe('rev-scheduling-job-save');
  expect(options).toEqual({body:retained});
  expect(options.body).not.toHaveProperty('skillRequirementMode');
  expect(JSON.parse(window.sessionStorage.getItem(storageKey)??'null')).toEqual(retained);
 });

 it('a verified refusal releases the retained cancellation, then the assignment can be cancelled and the overlapping job updates',async()=>{
  render(<SchedulingJobsPanel workspaceId={ws} userId={userId}/>);
  const retry=await retryButton();
  expandAll();
  await waitFor(()=>expect(within(card('assigned job')).getByRole('button',{name:'Cancel assignment'})).toBeDisabled());
  const cancelAssignment=within(card('assigned job')).getByRole('button',{name:'Cancel assignment'});
  // The blocking request is explained once, and linked from the disabled action.
  expect(within(card('assigned job')).getAllByText(pausedText)).toHaveLength(1);
  expect(cancelAssignment).toHaveAccessibleDescription(pausedText);
  await waitFor(()=>expect(reasonFor('Overlapping job','Harrison')).toBe('Already booked'));

  mocks.invoke.mockResolvedValueOnce(refusal());
  fireEvent.click(retry);
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
  expect(mocks.invoke.mock.calls[0]).toEqual(['rev-scheduling-job-save',{body:retained}]);

  const message=await within(card('assigned job')).findByText('Not cancelled. “assigned job” still has assigned workers. Cancel this job’s worker assignments first. Use Cancel assignment on this job, then cancel the job again.');
  await waitFor(()=>expect(message).toHaveFocus());
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  expect(screen.queryByRole('button',{name:'Retry job cancellation'})).toBeNull();
  expect(mocks.db.scheduling_jobs[0].status).toBe('open');

  await waitFor(()=>expect(within(card('assigned job')).getByRole('button',{name:'Cancel assignment'})).toBeEnabled());
  expect(screen.queryByText(pausedText)).toBeNull();

  mocks.invoke.mockImplementationOnce(async(name:string)=>{
   expect(name).toBe('rev-scheduling-assignment-save');
   mocks.db.scheduling_assignments=[{...mocks.db.scheduling_assignments[0],status:'cancelled',version:2}];
   return{data:{assignmentId,workspaceId:ws,workerId:harrison,jobId:assignedJobId,startAt,endAt,status:'cancelled',version:2},error:null};
  });
  fireEvent.click(within(card('assigned job')).getByRole('button',{name:'Cancel assignment'}));
  fireEvent.click(within(card('assigned job')).getByRole('button',{name:'Confirm cancellation'}));
  expect(await within(card('assigned job')).findByText(/Harrison’s assignment was cancelled\. 0 of 1 places filled\./)).toBeInTheDocument();
  await waitFor(()=>expect(reasonFor('Overlapping job','Harrison')).toBe('Available'));
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
 });

 for(const [label,reply] of [
  ['transport failure',()=>({data:null,error:{name:'FunctionsFetchError',context:new TypeError('Failed to fetch')}})],
  ['refusal for another request',()=>refusal('77777777-7777-4777-8777-777777777772')],
  ['unrecognised server error',()=>({data:null,error:{name:'FunctionsHttpError',context:new Response(JSON.stringify({error:'Job could not be saved.'}),{status:403})}})],
 ] as const){
  it(`keeps the exact request and the worker lock after a ${label}`,async()=>{
   render(<SchedulingJobsPanel workspaceId={ws} userId={userId}/>);
   const retry=await retryButton();
   mocks.invoke.mockResolvedValueOnce(reply());
   fireEvent.click(retry);
   await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
   expect(mocks.invoke.mock.calls[0]).toEqual(['rev-scheduling-job-save',{body:retained}]);
   expect(await screen.findByText('Not confirmed. “assigned job” may or may not have been cancelled. Select “Retry job cancellation” to send the same request again.')).toBeInTheDocument();
   expect(JSON.parse(window.sessionStorage.getItem(storageKey)??'null')).toEqual(retained);
   expandAll();
   await waitFor(()=>expect(within(card('assigned job')).getByRole('button',{name:'Cancel assignment'})).toBeDisabled());
   expect(within(card('assigned job')).getByRole('button',{name:'Cancel assignment'})).toHaveAccessibleDescription(pausedText);
   expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
 }
});

// The recovery message moves into the job's card once jobs load, so wait for the settled, enabled button.
async function retryButton(){await waitFor(()=>expect(within(card('assigned job')).getByRole('button',{name:'Retry job cancellation'})).toBeEnabled());return within(card('assigned job')).getByRole('button',{name:'Retry job cancellation'});}
function expandAll(){expand('assigned job');expand('Overlapping job');}
