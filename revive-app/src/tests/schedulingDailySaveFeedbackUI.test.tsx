// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {rememberDailySessionAttempt,type DailySessionAttempt} from '@/services/schedulingDailySessions';

const workspaceId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const storageKey=`rev-daily-job-save:${workspaceId}:${userId}`;
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{functions:{invoke:mocks.invoke},from:()=>({select:()=>({eq:async()=>({data:[],error:null})})})}}));
vi.mock('@/components/JobAssignmentsPanel',()=>({JobAssignmentsPanel:()=>null}));

import {SchedulingJobsPanel} from '@/components/SchedulingJobsPanel';

function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
function success(body:DailySessionAttempt){return{data:{requestId:body.requestId,workspaceId,scheduleType:'daily_daytime',jobs:[['2026-10-15T08:00:00.000Z','2026-10-15T16:00:00.000Z','44444444-4444-4444-8444-444444444441'],['2026-10-16T08:00:00.000Z','2026-10-16T16:00:00.000Z','44444444-4444-4444-8444-444444444442']].map(([startAt,endAt,jobId])=>({jobId,workspaceId,title:body.title,startAt,endAt,timezone:'Europe/London',location:body.location,requiredSkills:[],skillRequirementMode:body.skillRequirementMode,staffingCount:1,status:'open',version:1}))},error:null};}
const unavailable={data:null,error:{name:'FunctionsFetchError',context:new TypeError('Failed to fetch')}};
const retained=()=>{const raw=window.sessionStorage.getItem(storageKey);return raw?JSON.parse(raw):null;};
async function openForm(lastDay='2026-10-16'){
 render(<SchedulingJobsPanel workspaceId={workspaceId} userId={userId}/>);
 const add=await screen.findByRole('button',{name:'ADD JOB / SHIFT'});await waitFor(()=>expect(add).toBeEnabled());fireEvent.click(add);
 fireEvent.change(screen.getByLabelText('Title'),{target:{value:'Cardiff installation'}});
 fireEvent.change(screen.getByLabelText('Location (use Remote for remote work)'),{target:{value:'Cardiff'}});
 fireEvent.change(screen.getByLabelText('Start date'),{target:{value:'2026-10-15'}});
 fireEvent.change(screen.getByLabelText('End date (inclusive)'),{target:{value:lastDay}});
 return screen.getByRole('button',{name:'SAVE DAILY JOBS'});
}

beforeEach(()=>{mocks.invoke.mockReset();HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{cleanup();window.sessionStorage.clear();vi.restoreAllMocks();});

describe('mounted daily-session save feedback',()=>{
 it('shows Saving daily jobs… at once, blocks duplicate clicks and focuses the success beside the action',async()=>{
  const save=await openForm();const reply=deferred();mocks.invoke.mockReturnValueOnce(reply.promise);
  fireEvent.click(save);
  const busy=screen.getByRole('button',{name:'Saving daily jobs…'});
  expect(busy).toBeDisabled();expect(busy).toHaveAttribute('aria-busy','true');
  fireEvent.click(busy);fireEvent.submit(busy.closest('form') as HTMLFormElement);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  const body=mocks.invoke.mock.calls[0][1].body as DailySessionAttempt;
  expect(retained()).toEqual(body);
  await act(async()=>{reply.resolve(success(body));});
  const result=await screen.findByText('2 daily jobs saved. Each session requires 1 worker. No worker was assigned or notified.');
  await waitFor(()=>expect(result).toHaveFocus());
  expect(result).toHaveAttribute('role','status');
  expect(retained()).toBeNull();
  expect(screen.queryByRole('button',{name:'RETRY IDENTICAL DAILY SAVE'})).toBeNull();
 });

 it('keeps the exact request when unconfirmed and retries it unchanged with Retrying saved request…',async()=>{
  const save=await openForm();mocks.invoke.mockResolvedValueOnce(unavailable);
  fireEvent.click(save);
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Not confirmed. The daily jobs may or may not have been saved. Select “RETRY IDENTICAL DAILY SAVE” to send the same request again. It will not create a second batch.');
  await waitFor(()=>expect(alert).toHaveFocus());
  const first=mocks.invoke.mock.calls[0][1].body;
  expect(retained()).toEqual(first);
  expect(screen.getAllByRole('button',{name:'RETRY IDENTICAL DAILY SAVE'})).toHaveLength(1);
  expect(alert.parentElement).toContainElement(screen.getByRole('button',{name:'RETRY IDENTICAL DAILY SAVE'}));
  const reply=deferred();mocks.invoke.mockReturnValueOnce(reply.promise);
  fireEvent.click(screen.getByRole('button',{name:'RETRY IDENTICAL DAILY SAVE'}));
  const retrying=screen.getByRole('button',{name:'Retrying saved request…'});
  expect(retrying).toBeDisabled();fireEvent.click(retrying);
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  expect(mocks.invoke.mock.calls[1]).toEqual(['rev-scheduling-daily-sessions-save',{body:first}]);
  await act(async()=>{reply.resolve(unavailable);});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveFocus());
  expect(retained()).toEqual(first);
 });

 it('reports a refusal without sending or retaining anything',async()=>{
  const save=await openForm('2026-10-14');
  fireEvent.click(save);
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Not saved. Check dates, selected weekdays, daytime hours, timezone and staffing.');
  await waitFor(()=>expect(alert).toHaveFocus());
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(retained()).toBeNull();
  expect(screen.queryByRole('button',{name:'RETRY IDENTICAL DAILY SAVE'})).toBeNull();
 });

 it('retries a request restored after reload beside its button and scrolls only when the result is off screen',async()=>{
  const attempt:DailySessionAttempt={workspaceId,requestId:'55555555-5555-4555-8555-555555555555',title:'Cardiff installation',timezone:'Europe/London',location:'Cardiff',requiredSkills:[],skillRequirementMode:'all',staffingCount:1,firstDay:'2026-10-15',lastDay:'2026-10-16',workingDays:[1,2,3,4,5],startLocal:'09:00',endLocal:'17:00'};
  rememberDailySessionAttempt(window.sessionStorage,userId,attempt);
  const scroll=vi.fn();HTMLElement.prototype.scrollIntoView=scroll;
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({top:2000,bottom:2040,left:0,right:0,width:0,height:40,x:0,y:2000,toJSON:()=>({})});
  render(<SchedulingJobsPanel workspaceId={workspaceId} userId={userId}/>);
  const retry=await screen.findByRole('button',{name:'RETRY IDENTICAL DAILY SAVE'});await waitFor(()=>expect(retry).toBeEnabled());
  mocks.invoke.mockResolvedValueOnce(unavailable);
  fireEvent.click(retry);
  const alert=await screen.findByRole('alert');await waitFor(()=>expect(alert).toHaveFocus());
  expect(scroll).toHaveBeenCalledWith({block:'nearest',behavior:'smooth'});
  expect(mocks.invoke).toHaveBeenCalledWith('rev-scheduling-daily-sessions-save',{body:attempt});
  expect(retained()).toEqual(attempt);
  scroll.mockClear();vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({top:10,bottom:50,left:0,right:0,width:0,height:40,x:0,y:10,toJSON:()=>({})});
  mocks.invoke.mockResolvedValueOnce(success(attempt));
  fireEvent.click(screen.getByRole('button',{name:'RETRY IDENTICAL DAILY SAVE'}));
  const done=await screen.findByText(/2 daily jobs saved/);await waitFor(()=>expect(done).toHaveFocus());
  expect(scroll).not.toHaveBeenCalled();
  expect(retained()).toBeNull();
 });
});
