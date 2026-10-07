// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {SchedulingJob} from '@/services/schedulingJobs';
import type {PlannerData} from '@/services/schedulingPlanner';
import type {Worker} from '@/services/schedulingWorkers';
import {rememberAssignment,restoreAssignment,type AssignmentAttempt} from '@/services/schedulingAssignments';

const workspaceId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333',harrison='44444444-4444-4444-8444-444444444441',priya='44444444-4444-4444-8444-444444444442',assignmentId='55555555-5555-4555-8555-555555555555';
const startAt='2026-10-08T10:00:00.000Z',endAt='2026-10-08T14:30:00.000Z';
type Row={id:string;workspace_id:string;worker_id:string;job_id:string;start_at:string;end_at:string;status:'active'|'cancelled';version:number};
const mocks=vi.hoisted(()=>({rows:[] as unknown[],invoke:vi.fn(),readFails:false}));
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{functions:{invoke:mocks.invoke},from:()=>({select:()=>({eq:()=>({eq:async()=>mocks.readFails?{data:null,error:{message:'down'}}:{data:structuredClone(mocks.rows),error:null}})})})}}));
const workers:Worker[]=[{workerId:harrison,workspaceId,displayName:'Harrison',roleLabels:[],skillTags:['Admin'],active:true,version:1},{workerId:priya,workspaceId,displayName:'Priya',roleLabels:[],skillTags:['Admin'],active:true,version:1}];
vi.mock('@/services/schedulingWorkers',()=>({loadSchedulingWorkers:async()=>{if(mocks.readFails)throw Error('down');return workers;}}));
vi.mock('@/services/workerWorkingPatterns',()=>({loadWorkingPattern:async()=>({version:1})}));
vi.mock('@/services/schedulingPlanner',async importOriginal=>{const actual=await importOriginal<typeof import('@/services/schedulingPlanner')>();return{...actual,loadPlannerData:async():Promise<PlannerData>=>{if(mocks.readFails)throw Error('down');return{workers:workers.map(w=>({id:w.workerId,name:w.displayName,active:true,skills:w.skillTags})),jobs:[{id:jobId,title:job.title,startAt,endAt,timezone:'Europe/London',location:job.location,skills:['Admin'],count:1,status:'open'}],assignments:(mocks.rows as Row[]).map(r=>({id:r.id,workerId:r.worker_id,jobId:r.job_id,startAt:r.start_at,endAt:r.end_at,status:r.status})),patterns:workers.map(w=>({workerId:w.workerId,timezone:'Europe/London',days:[4],startLocal:'09:00',endLocal:'17:00',from:'2026-10-01',until:null})),leave:[]};}};});

import {JobAssignmentsPanel} from '@/components/JobAssignmentsPanel';

const job:SchedulingJob={jobId,workspaceId,title:'REV allocation test',startAt,endAt,timezone:'Europe/London',location:'Cardiff',requiredSkills:['Admin'],staffingCount:1,status:'open',version:1};
const activeRow=():Row=>({id:assignmentId,workspace_id:workspaceId,worker_id:harrison,job_id:jobId,start_at:'2026-10-08T10:00:00+00:00',end_at:'2026-10-08T14:30:00+00:00',status:'active',version:1});
const cancelledResult={assignmentId,workspaceId,workerId:harrison,jobId,startAt,endAt,status:'cancelled',version:2};
const storageKey=`rev-allocation:${workspaceId}:${userId}:${jobId}`;
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
function mount(props:Partial<Parameters<typeof JobAssignmentsPanel>[0]>={}){return render(<JobAssignmentsPanel workspaceId={workspaceId} userId={userId} job={job} when="08/10/2026 11:00–15:30" jobActions={<><button>Edit job</button><button>Cancel job</button></>} {...props}/>);}
async function openConfirmation(){mount();fireEvent.click(await screen.findByRole('button',{name:'Cancel assignment'}));return screen.getByRole('button',{name:'Confirm cancellation'});}
const retained=()=>restoreAssignment(window.sessionStorage,workspaceId,userId,jobId);

beforeEach(()=>{mocks.rows=[activeRow()];mocks.readFails=false;mocks.invoke.mockReset();HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{cleanup();window.sessionStorage.clear();vi.restoreAllMocks();});

describe('mounted job allocation panel',()=>{
 it('shows a compact summary with separate job actions and tucks guidance and history away',async()=>{
  mocks.rows=[activeRow(),{...activeRow(),id:'66666666-6666-4666-8666-666666666666',worker_id:priya,status:'cancelled',version:2}];
  mount();
  expect(await screen.findByText('1 of 1 assigned')).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'REV allocation test'})).toBeInTheDocument();
  expect(screen.getByText('08/10/2026 11:00–15:30')).toBeInTheDocument();
  expect(screen.getByText('Cardiff')).toBeInTheDocument();
  expect(within(screen.getByRole('region',{name:'Workers'})).getByText('Harrison')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Assign worker'})).toBeDisabled();
  const actions=screen.getByRole('region',{name:'Job actions'});
  expect(within(actions).getByRole('button',{name:'Edit job'})).toBeInTheDocument();
  expect(within(actions).getByRole('button',{name:'Cancel job'})).toBeInTheDocument();
  expect(within(screen.getByRole('region',{name:'Workers'})).queryByRole('button',{name:'Edit job'})).toBeNull();
  const why=screen.getByText('Why can’t I assign someone?').closest('details');expect(why).not.toHaveAttribute('open');expect(within(why as HTMLElement).getByText(/Priya:/)).toBeInTheDocument();
  const history=screen.getByText('View assignment history').closest('details');expect(history).not.toHaveAttribute('open');expect(within(history as HTMLElement).getByText('Priya – cancelled')).toBeInTheDocument();
  expect(screen.getAllByText('The one place is filled. Cancel an assignment to free a place.')).toHaveLength(1);
  expect(document.body.textContent).not.toMatch(/server|request|endpoint|revision/i);
 });

 it('confirms cancellation, shows Cancelling… immediately, then reloads and shows the freed place',async()=>{
  const confirm=await openConfirmation();
  await waitFor(()=>expect(confirm).toHaveFocus());
  const reply=deferred();mocks.invoke.mockReturnValueOnce(reply.promise);
  fireEvent.click(confirm);
  expect(screen.getByRole('button',{name:'Cancelling…'})).toHaveAttribute('aria-busy','true');
  fireEvent.click(screen.getByRole('button',{name:'Cancelling…'}));
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  const body=mocks.invoke.mock.calls[0][1].body;
  expect(body).toEqual({workspaceId,workerId:harrison,jobId,requestId:expect.any(String),assignmentId,status:'cancelled',expectedVersion:1,expectedWorkerVersion:null,expectedJobVersion:null,expectedPatternVersion:null});
  expect(retained()?.requestId).toBe(body.requestId);
  mocks.rows=[{...activeRow(),status:'cancelled',version:2}];
  await act(async()=>{reply.resolve({data:cancelledResult,error:null});});
  const done=await screen.findByText('Harrison’s assignment was cancelled. 0 of 1 places filled. No notification was sent.');
  await waitFor(()=>expect(done).toHaveFocus());
  expect(screen.getByText('0 of 1 assigned')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Cancel assignment'})).toBeNull();
  expect(screen.getByRole('combobox',{name:'Choose a worker'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Assign worker'})).toBeDisabled();
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });

 it.each([
  ['transport failure',()=>({data:null,error:{name:'FunctionsFetchError',context:new TypeError('Failed to fetch')}}),'Cancelling Harrison’s assignment could not reach Revive, so it is not confirmed. Check your connection, then select “Retry cancellation”.'],
  ['server failure',()=>({data:null,error:{name:'FunctionsHttpError',context:new Response(JSON.stringify({code:'outcome_unknown'}),{status:503})}}),'Revive could not confirm cancelling Harrison’s assignment. Select “Retry cancellation” to send the same change again.'],
  ['malformed success',()=>({data:{...cancelledResult,version:3},error:null}),'Revive replied, but the reply could not be checked, so cancelling Harrison’s assignment is not confirmed. Select “Retry cancellation” to send the same change again.'],
  ['unrecognised refusal',()=>({data:null,error:{name:'FunctionsHttpError',context:new Response(JSON.stringify({status:'refused',code:'private',requestId:'x'}),{status:409})}}),'Revive replied, but the reply could not be checked, so cancelling Harrison’s assignment is not confirmed. Select “Retry cancellation” to send the same change again.'],
 ])('keeps the exact request after a %s and focuses one recovery message',async(_label,reply,text)=>{
  const confirm=await openConfirmation();mocks.invoke.mockResolvedValueOnce(reply());
  fireEvent.click(confirm);
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveTextContent(text);await waitFor(()=>expect(alert).toHaveFocus());
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(retained()).toMatchObject({assignmentId,status:'cancelled',expectedVersion:1});
  expect(screen.getByText('1 of 1 assigned')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Cancel assignment'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Retry cancellation'})).toBeEnabled();
  expect(screen.queryByText(/places are filled|place is filled/)).toBeNull();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });

 it('retries the identical request, shows Retrying…, and clears recovery only after confirmation',async()=>{
  const confirm=await openConfirmation();mocks.invoke.mockResolvedValueOnce({data:null,error:{context:new TypeError('Failed to fetch')}});
  fireEvent.click(confirm);await screen.findByRole('alert');
  const first=mocks.invoke.mock.calls[0][1].body;
  const reply=deferred();mocks.invoke.mockReturnValueOnce(reply.promise);
  fireEvent.click(screen.getByRole('button',{name:'Retry cancellation'}));
  expect(screen.getByRole('button',{name:'Retrying…'})).toBeDisabled();
  expect(mocks.invoke.mock.calls[1][1].body).toEqual(first);
  mocks.rows=[{...activeRow(),status:'cancelled',version:2}];
  await act(async()=>{reply.resolve({data:cancelledResult,error:null});});
  expect(await screen.findByText(/0 of 1 places filled/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
 });

 it('restores a retained request after reload and resends it unchanged; a known refusal clears it and refreshes',async()=>{
  const attempt:AssignmentAttempt={workspaceId,workerId:harrison,jobId,requestId:'77777777-7777-4777-8777-777777777777',assignmentId,status:'cancelled',expectedVersion:1,expectedWorkerVersion:null,expectedJobVersion:null,expectedPatternVersion:null,expectedStartAt:startAt,expectedEndAt:endAt};
  rememberAssignment(window.sessionStorage,userId,attempt);
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Cancelling Harrison’s assignment was not confirmed. Select “Retry cancellation” to send the same change again.');
  await screen.findByText('1 of 1 assigned');
  mocks.invoke.mockResolvedValueOnce({data:null,error:{context:new Response(JSON.stringify({status:'refused',code:'stale_assignment',requestId:attempt.requestId}),{status:409})}});
  fireEvent.click(screen.getByRole('button',{name:'Retry cancellation'}));
  const {expectedStartAt:_s,expectedEndAt:_e,...sent}=attempt;
  expect(mocks.invoke).toHaveBeenCalledWith('rev-scheduling-assignment-save',{body:sent});
  const refusal=await screen.findByText('Assignment changed. Refresh before cancelling. The allocation has been refreshed. Review it, then try again.');
  await waitFor(()=>expect(refusal).toHaveFocus());
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  expect(screen.queryByRole('button',{name:'Retry cancellation'})).toBeNull();
 });

 it('scrolls the confirmation into view only when it is off screen and explains a parent lock once',async()=>{
  const scroll=vi.fn();HTMLElement.prototype.scrollIntoView=scroll;
  await openConfirmation();await waitFor(()=>expect(screen.getByRole('button',{name:'Confirm cancellation'})).toHaveFocus());
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Keep assignment'}));
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({top:2000,bottom:2040,left:0,right:0,width:0,height:40,x:0,y:2000,toJSON:()=>({})});
  fireEvent.click(screen.getByRole('button',{name:'Cancel assignment'}));
  await waitFor(()=>expect(scroll).toHaveBeenCalledWith({block:'nearest',behavior:'smooth'}));
  cleanup();mount({disabled:true});await screen.findByText('1 of 1 assigned');
  expect(screen.getAllByText('Worker changes are paused while this job is being edited or saved. Finish or discard that change first.')).toHaveLength(1);
  expect(screen.getByRole('button',{name:'Cancel assignment'})).toBeDisabled();
 });

 it('shows Refreshing… and a result beside Refresh allocation, focusing a failure',async()=>{
  mount();await screen.findByText('1 of 1 assigned');
  fireEvent.click(screen.getByRole('button',{name:'Refresh allocation'}));
  expect(screen.getByRole('button',{name:'Refreshing…'})).toBeDisabled();
  expect(await screen.findByText('Allocation refreshed. 1 of 1 places filled.')).toBeInTheDocument();
  mocks.readFails=true;
  fireEvent.click(screen.getByRole('button',{name:'Refresh allocation'}));
  const failure=await screen.findByText('The allocation could not be refreshed. Check your connection, then select “Refresh allocation” again.');
  await waitFor(()=>expect(failure).toHaveFocus());
 });

 it('collapses worker allocation when asked, keeps the summary visible and never hides pending recovery',async()=>{
  mount({collapsible:true,disabled:true,disabledReason:'Job changes are paused until the earlier daily-jobs save is confirmed.'});
  expect(await screen.findByText('1 of 1 assigned')).toBeInTheDocument();
  const toggle=screen.getByRole('button',{name:'Show worker allocation'});
  expect(toggle).toHaveAttribute('aria-expanded','false');
  expect(screen.queryByRole('button',{name:'Refresh allocation'})).toBeNull();
  expect(screen.queryByText('Job changes are paused until the earlier daily-jobs save is confirmed.')).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole('button',{name:'Hide worker allocation'})).toHaveAttribute('aria-expanded','true');
  expect(screen.getAllByText('Job changes are paused until the earlier daily-jobs save is confirmed.')).toHaveLength(1);
  expect(screen.queryByText(/being edited or saved/)).toBeNull();
  cleanup();
  rememberAssignment(window.sessionStorage,userId,{workspaceId,workerId:harrison,jobId,requestId:'77777777-7777-4777-8777-777777777777',assignmentId,status:'cancelled',expectedVersion:1,expectedWorkerVersion:null,expectedJobVersion:null,expectedPatternVersion:null,expectedStartAt:startAt,expectedEndAt:endAt});
  mount({collapsible:true});
  expect(await screen.findByRole('button',{name:'Retry cancellation'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Show worker allocation'})).toBeNull();
 });
});
