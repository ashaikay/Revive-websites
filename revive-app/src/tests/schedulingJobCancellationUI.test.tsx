// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type {ReactNode} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {rememberDailySessionAttempt} from '@/services/schedulingDailySessions';
import type {SchedulingJob} from '@/services/schedulingJobs';

const workspaceId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const jobKey=`rev-job-save:${workspaceId}:${userId}`,dailyKey=`rev-daily-job-save:${workspaceId}:${userId}`;
const mocks=vi.hoisted(()=>({invoke:vi.fn(),documentStatus:vi.fn(),read:vi.fn()}));
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{functions:{invoke:(name:string,options:{body?:Record<string,unknown>}={})=>{
 if(name!=='rev-scheduling-job-document-analyse')return mocks.invoke(name,options);
 if(options.body?.action!=='status')throw Error('Unexpected document analysis call');
 return mocks.documentStatus(name,options);
}},from:()=>({select:()=>({eq:mocks.read})})}}));
vi.mock('@/components/JobAssignmentsPanel',()=>({JobAssignmentsPanel:({job,note,jobActions,disabled}:{job:SchedulingJob;note?:ReactNode;jobActions?:ReactNode;disabled?:boolean})=><article aria-label={`${job.title} job`} data-disabled={String(!!disabled)}><h3>{job.title}</h3>{note}{jobActions&&<section aria-label="Job actions">{jobActions}</section>}</article>}));

import {SchedulingJobsPanel} from '@/components/SchedulingJobsPanel';

type Row={id:string;title:string;start_at:string;end_at:string;location:string;status:'open'|'cancelled';version:number};
const row=(id:string,title:string,day:string,patch:Partial<Row>={}):Row=>({id,title,start_at:`2026-10-${day}T10:00:00.000Z`,end_at:`2026-10-${day}T14:30:00.000Z`,location:'Cardiff',status:'open',version:2,...patch});
const raw=(r:Row)=>({id:r.id,workspace_id:workspaceId,title:r.title,start_at:r.start_at,end_at:r.end_at,timezone:'Europe/London',location:r.location,required_skills:[],staffing_count:1,status:r.status,version:r.version});
const allocation=row('33333333-3333-4333-8333-333333333331','REV allocation test','08');
const other=row('33333333-3333-4333-8333-333333333332','Office cover','09',{location:'Leeds'});
const listOf=(...rows:Row[])=>({data:rows.map(raw),error:null});
const unavailable={data:null,error:{name:'FunctionsFetchError',context:new TypeError('Failed to fetch')}};
function confirmed(body:Record<string,unknown>){return{data:{jobId:body.jobId,workspaceId,title:body.title,startAt:body.startAt,endAt:body.endAt,timezone:body.timezone,location:body.location,requiredSkills:body.requiredSkills,staffingCount:body.staffingCount,status:body.status,version:(body.expectedVersion as number)+1},error:null};}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
const retained=()=>{const value=window.sessionStorage.getItem(jobKey);return value?JSON.parse(value):null;};
const card=(title:string)=>screen.getByRole('article',{name:`${title} job`});
async function mountWith(...rows:Row[]){mocks.read.mockResolvedValue(listOf(...rows));render(<SchedulingJobsPanel workspaceId={workspaceId} userId={userId}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'ADD JOB / SHIFT'})).toBeEnabled());}

beforeEach(()=>{mocks.invoke.mockReset();mocks.documentStatus.mockReset().mockResolvedValue({data:{available:false,model:null},error:null});mocks.read.mockReset();HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{cleanup();window.sessionStorage.clear();vi.restoreAllMocks();});

describe('mounted job cancellation and list tidy-up',()=>{
 it('confirms, shows Cancelling…, hides the job at once and focuses the success result',async()=>{
  await mountWith(allocation,other);
  const actions=within(card('REV allocation test')).getByRole('region',{name:'Job actions'});
  expect(actions).toHaveTextContent('Removes this job from active planning; history is kept.');
  fireEvent.click(within(actions).getByRole('button',{name:/^Cancel job/}));
  const confirm=within(actions).getByRole('group',{name:'Confirm job cancellation'});
  expect(confirm).toHaveTextContent('Cancel “REV allocation test”? Removes this job from active planning; history is kept.');
  const yes=within(confirm).getByRole('button',{name:'Yes, cancel job'});
  await waitFor(()=>expect(yes).toHaveFocus());
  expect(within(card('Office cover')).getByRole('button',{name:/^Cancel job/})).toBeDisabled();
  expect(screen.getAllByText('Confirm or keep the cancellation of “REV allocation test” first.')).toHaveLength(1);
  const reply=deferred<unknown>(),reloadList=deferred<unknown>();
  mocks.invoke.mockReturnValueOnce(reply.promise);mocks.read.mockReturnValueOnce(reloadList.promise);
  fireEvent.click(yes);
  const busy=within(confirm).getByRole('button',{name:'Cancelling…'});
  expect(busy).toBeDisabled();expect(busy).toHaveAttribute('aria-busy','true');
  fireEvent.click(busy);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  const [name,{body}]=mocks.invoke.mock.calls[0];
  expect(name).toBe('rev-scheduling-job-save');
  expect(body).toMatchObject({jobId:allocation.id,status:'cancelled',expectedVersion:2,title:'REV allocation test'});
  expect(retained()).toEqual(body);
  await act(async()=>{reply.resolve(confirmed(body));});
  // Hidden before the list reload has returned.
  await waitFor(()=>expect(screen.queryByRole('article',{name:'REV allocation test job'})).toBeNull());
  const result=screen.getByText('“REV allocation test” was cancelled and removed from active planning. Its history is kept under Cancelled job history.');
  await waitFor(()=>expect(result).toHaveFocus());
  expect(result).toHaveAttribute('role','status');
  expect(retained()).toBeNull();
  await act(async()=>{reloadList.resolve(listOf({...allocation,status:'cancelled',version:3},other));});
  const history=screen.getByText('Cancelled job history (1)').closest('details') as HTMLDetailsElement;
  expect(history.open).toBe(false);
  expect(screen.queryByRole('article',{name:'REV allocation test job'})).toBeNull();
  history.open=true;fireEvent(history,new Event('toggle'));
  expect(await within(history).findByRole('article',{name:'REV allocation test job'})).toBeInTheDocument();
  expect(within(history).queryByRole('region',{name:'Job actions'})).toBeNull();
  expect(result.parentElement).toContainElement(screen.getByRole('button',{name:'ADD JOB / SHIFT'}));
  fireEvent.click(screen.getByRole('button',{name:'ADD JOB / SHIFT'}));
  expect(screen.queryByText('“REV allocation test” was cancelled and removed from active planning. Its history is kept under Cancelled job history.')).toBeNull();
 });

 it('keeps an unconfirmed cancellation, explains the lock once and retries the identical request',async()=>{
  await mountWith(allocation,other);
  fireEvent.click(within(card('REV allocation test')).getByRole('button',{name:/^Cancel job/}));
  mocks.invoke.mockResolvedValueOnce(unavailable);
  fireEvent.click(screen.getByRole('button',{name:'Yes, cancel job'}));
  const alert=await within(card('REV allocation test')).findByRole('alert');
  expect(alert).toHaveTextContent('Change not confirmed');
  expect(alert).toHaveTextContent('Not confirmed. “REV allocation test” may or may not have been cancelled. Select “Retry job cancellation” to send the same request again.');
  await waitFor(()=>expect(alert).toHaveFocus());
  const first=mocks.invoke.mock.calls[0][1].body;
  expect(retained()).toEqual(first);
  expect(card('REV allocation test')).toBeInTheDocument();
  expect(screen.getAllByText('Other job changes are paused until the change to “REV allocation test” is confirmed. Use its retry button first.')).toHaveLength(1);
  for(const title of ['REV allocation test','Office cover']){expect(within(card(title)).getByRole('button',{name:/^Cancel job/})).toBeDisabled();expect(within(card(title)).getByRole('button',{name:/^Edit job/})).toBeDisabled();}
  expect(screen.getAllByRole('button',{name:'Retry job cancellation'})).toHaveLength(1);
  const reply=deferred<unknown>();mocks.invoke.mockReturnValueOnce(reply.promise);
  fireEvent.click(within(alert).getByRole('button',{name:'Retry job cancellation'}));
  const retrying=screen.getByRole('button',{name:'Retrying…'});expect(retrying).toBeDisabled();fireEvent.click(retrying);
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  expect(mocks.invoke.mock.calls[1]).toEqual(['rev-scheduling-job-save',{body:first}]);
  await act(async()=>{reply.resolve(unavailable);});
  await waitFor(()=>expect(within(card('REV allocation test')).getByRole('alert')).toHaveFocus());
  expect(retained()).toEqual(first);
 });

 it('reports a refusal when the request could not be kept, without sending anything',async()=>{
  await mountWith(allocation);
  fireEvent.click(within(card('REV allocation test')).getByRole('button',{name:/^Cancel job/}));
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  fireEvent.click(screen.getByRole('button',{name:'Yes, cancel job'}));
  const alert=await within(card('REV allocation test')).findByRole('alert');
  expect(alert).toHaveTextContent('Not cancelled. Nothing was sent. Refresh the page, then try again.');
  await waitFor(()=>expect(alert).toHaveFocus());
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'Retry job cancellation'})).toBeNull();
 });

 it('a retained daily save locks job actions with one explanation and is never cleared',async()=>{
  const attempt={workspaceId,requestId:'55555555-5555-4555-8555-555555555555',title:'Cardiff installation',timezone:'Europe/London',location:'Cardiff',requiredSkills:[],skillRequirementMode:'all' as const,staffingCount:1,firstDay:'2026-10-15',lastDay:'2026-10-16',workingDays:[1,2,3,4,5],startLocal:'09:00',endLocal:'17:00'};
  rememberDailySessionAttempt(window.sessionStorage,userId,attempt);
  mocks.read.mockResolvedValue(listOf(allocation,other));
  render(<SchedulingJobsPanel workspaceId={workspaceId} userId={userId}/>);
  await screen.findByRole('article',{name:'Office cover job'});
  expect(screen.getAllByText('Job changes are paused until the earlier daily-jobs save is confirmed. Select “RETRY IDENTICAL DAILY SAVE” first.')).toHaveLength(1);
  for(const title of ['REV allocation test','Office cover']){const button=within(card(title)).getByRole('button',{name:/^Cancel job/});expect(button).toBeDisabled();expect(button).toHaveAccessibleDescription(/paused until the earlier daily-jobs save is confirmed/);expect(card(title)).toHaveAttribute('data-disabled','true');}
  expect(screen.getAllByRole('button',{name:'RETRY IDENTICAL DAILY SAVE'})).toHaveLength(1);
  expect(JSON.parse(window.sessionStorage.getItem(dailyKey) as string)).toEqual(attempt);
  expect(mocks.invoke).not.toHaveBeenCalled();
 });

 it('labels separate daily sessions and flags only true duplicates without removing anything',async()=>{
  const first=row('33333333-3333-4333-8333-333333333341','Cardiff installation','15'),second=row('33333333-3333-4333-8333-333333333342','Cardiff installation','16'),copy=row('33333333-3333-4333-8333-333333333343','Cardiff installation','16');
  await mountWith(first,second,copy);
  const cards=screen.getAllByRole('article',{name:'Cardiff installation job'});
  expect(cards).toHaveLength(3);
  expect(cards[0]).toHaveTextContent('Session 1 of 2 in this series – a separate job, not a duplicate.');
  expect(cards[0]).not.toHaveTextContent('Possible duplicate');
  for(const duplicate of cards.slice(1)){expect(duplicate).toHaveTextContent('Session 2 of 2 in this series');expect(duplicate).toHaveTextContent('Possible duplicate: another active job has the same title, location, date and time.');}
  expect(screen.getByText('2 active jobs repeat the same title, location, date and time as another job. They are marked “Possible duplicate”. Nothing is removed automatically.')).toBeInTheDocument();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(screen.queryByText(/Cancelled job history/)).toBeNull();
 });
});
