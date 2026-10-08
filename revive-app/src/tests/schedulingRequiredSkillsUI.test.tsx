// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type {ReactNode} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {SchedulingJob} from '@/services/schedulingJobs';

const workspaceId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),jobs:[] as unknown[],workers:[] as unknown[],workersFail:false}));
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{functions:{invoke:mocks.invoke},from:(table:string)=>({select:()=>({eq:async()=>table==='scheduling_workers'?(mocks.workersFail?{data:null,error:{message:'down'}}:{data:structuredClone(mocks.workers),error:null}):{data:structuredClone(mocks.jobs),error:null}})})}}));
vi.mock('@/components/JobAssignmentsPanel',()=>({JobAssignmentsPanel:({job,jobActions}:{job:SchedulingJob;jobActions?:ReactNode})=><article aria-label={`${job.title} job`}><h3>{job.title}</h3>{jobActions}</article>}));

import {SchedulingJobsPanel} from '@/components/SchedulingJobsPanel';
import {skillOptions} from '@/components/RequiredSkillsSelector';

let n=0;
const worker=(name:string,skills:string[],active=true)=>({id:`44444444-4444-4444-8444-${String(++n).padStart(12,'0')}`,workspace_id:workspaceId,display_name:name,role_labels:[],skill_tags:skills,active,version:1});
const jobId='33333333-3333-4333-8333-333333333331';
const jobRow=(skills:string[])=>({id:jobId,workspace_id:workspaceId,title:'Site survey',start_at:'2026-11-13T10:00:00.000Z',end_at:'2026-11-13T15:00:00.000Z',timezone:'Europe/London',location:'Cardiff',required_skills:skills,staffing_count:1,status:'open',version:3});
const skillsGroup=()=>screen.getByRole('group',{name:'Required skills'});
const boxes=()=>within(skillsGroup()).getAllByRole('checkbox').map(box=>[box.closest('label')?.textContent,(box as HTMLInputElement).checked]);
const box=(label:string)=>within(skillsGroup()).getByRole('checkbox',{name:new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`)});
async function mount(){render(<SchedulingJobsPanel workspaceId={workspaceId} userId={userId}/>);const add=await screen.findByRole('button',{name:'ADD JOB / SHIFT'});await waitFor(()=>expect(add).toBeEnabled());}

beforeEach(()=>{n=0;mocks.invoke.mockReset();mocks.workersFail=false;mocks.jobs=[];mocks.workers=[worker('Karol',['Dsear & Fire','First aid']),worker('Tom',['dsear  &  FIRE','Admin']),worker('Kim',['DSEAR & FIRE']),worker('Ann',['Dsear & Fire']),worker('Old',['Forklift'],false)];HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{cleanup();window.sessionStorage.clear();vi.restoreAllMocks();});

describe('required skills selector',()=>{
 it('lists saved worker skills once per case/spacing variant and submits the selected labels for daily jobs',async()=>{
  await mount();
  fireEvent.click(screen.getByRole('button',{name:'ADD JOB / SHIFT'}));
  expect(screen.queryByLabelText(/comma-separated/)).toBeNull();
  expect(skillsGroup()).toHaveTextContent('Choose the skills needed. Workers must have every selected skill.');
  expect(skillsGroup()).toHaveTextContent('No specific skills required.');
  await waitFor(()=>expect(boxes()).toEqual([['Admin',false],['Dsear & Fire',false],['First aid',false]]));
  expect(skillsGroup()).not.toHaveTextContent('Forklift');

  fireEvent.click(box('First aid'));fireEvent.click(box('Dsear & Fire'));
  expect(skillsGroup()).not.toHaveTextContent('No specific skills required.');
  fireEvent.change(screen.getByLabelText('Title'),{target:{value:'Cardiff installation'}});
  fireEvent.change(screen.getByLabelText('Location (use Remote for remote work)'),{target:{value:'Cardiff'}});
  fireEvent.change(screen.getByLabelText('Start date'),{target:{value:'2026-10-15'}});
  fireEvent.change(screen.getByLabelText('End date (inclusive)'),{target:{value:'2026-10-15'}});
  mocks.invoke.mockResolvedValueOnce({data:null,error:{name:'FunctionsFetchError',context:new TypeError('Failed to fetch')}});
  fireEvent.click(screen.getByRole('button',{name:'SAVE DAILY JOBS'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
  const [name,{body}]=mocks.invoke.mock.calls[0];
  expect(name).toBe('rev-scheduling-daily-sessions-save');
  expect(body.requiredSkills).toEqual(['Dsear & Fire','First aid']);
  // The unconfirmed request is retained exactly; the retry resends the same skills.
  await screen.findByText(/Not confirmed\. The daily jobs may or may not have been saved\./);
  mocks.invoke.mockResolvedValueOnce({data:null,error:{name:'FunctionsFetchError',context:new TypeError('Failed to fetch')}});
  fireEvent.click(screen.getAllByRole('button',{name:'RETRY IDENTICAL DAILY SAVE'})[0]);
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(2));
  expect(mocks.invoke.mock.calls[1][1].body).toEqual(body);
 });

 it('keeps existing job requirements visible and unchanged when editing, including skills no worker has',async()=>{
  mocks.jobs=[jobRow(['DSEAR & Fire','Confined space'])];
  await mount();
  fireEvent.click(screen.getByRole('button',{name:'Edit job'}));
  await waitFor(()=>expect(boxes()).toEqual([['Admin',false],['Confined spaceNo current worker has this skill',true],['DSEAR & Fire',true],['First aid',false]]));

  mocks.invoke.mockImplementationOnce(async(_name:string,{body}:{body:Record<string,unknown>})=>({data:{jobId:body.jobId,workspaceId,title:body.title,startAt:body.startAt,endAt:body.endAt,timezone:body.timezone,location:body.location,requiredSkills:body.requiredSkills,staffingCount:body.staffingCount,status:body.status,version:4},error:null}));
  fireEvent.click(screen.getByRole('button',{name:'SAVE JOB'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
  expect(mocks.invoke.mock.calls[0][0]).toBe('rev-scheduling-job-save');
  expect(mocks.invoke.mock.calls[0][1].body.requiredSkills).toEqual(['Confined space','DSEAR & Fire']);
 });

 it('unticking an existing requirement keeps it listed so it can be re-ticked, and none selected submits no skills',async()=>{
  mocks.jobs=[jobRow(['Confined space'])];
  await mount();
  fireEvent.click(screen.getByRole('button',{name:'Edit job'}));
  await waitFor(()=>expect(box('Confined space')).toBeChecked());
  fireEvent.click(box('Confined space'));
  expect(box('Confined space')).not.toBeChecked();
  expect(skillsGroup()).toHaveTextContent('No specific skills required.');
  mocks.invoke.mockImplementationOnce(async(_name:string,{body}:{body:Record<string,unknown>})=>({data:{jobId:body.jobId,workspaceId,title:body.title,startAt:body.startAt,endAt:body.endAt,timezone:body.timezone,location:body.location,requiredSkills:body.requiredSkills,staffingCount:body.staffingCount,status:body.status,version:4},error:null}));
  fireEvent.click(screen.getByRole('button',{name:'SAVE JOB'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
  expect(mocks.invoke.mock.calls[0][1].body.requiredSkills).toEqual([]);
 });

 it('if worker skills cannot be loaded, existing requirements stay selected and are saved unchanged',async()=>{
  mocks.workersFail=true;mocks.jobs=[jobRow(['Admin'])];
  await mount();
  fireEvent.click(screen.getByRole('button',{name:'Edit job'}));
  expect(await within(skillsGroup()).findByRole('alert')).toHaveTextContent('Saved worker skills could not be loaded. Skills already on this job are kept.');
  expect(boxes()).toEqual([['Admin',true]]);
 });

 it('refreshes the list after a worker skill is saved elsewhere',async()=>{
  await mount();
  fireEvent.click(screen.getByRole('button',{name:'ADD JOB / SHIFT'}));
  await waitFor(()=>expect(boxes()).toHaveLength(3));
  mocks.workers=[...mocks.workers,worker('Lee',['Working at height'])];
  await act(async()=>{window.dispatchEvent(new Event('rev-scheduling-changed'));});
  await waitFor(()=>expect(boxes().map(([label])=>label)).toContain('Working at height'));
 });
});

describe('skillOptions',()=>{
 const w=(skills:string[],active=true)=>({workerId:'x',workspaceId,displayName:'x',roleLabels:[],skillTags:skills,active,version:1});
 it('merges only exact key matches; distinct skills such as “Dsear” stay separate',()=>{
  expect(skillOptions([w(['Dsear & Fire']),w(['Dsear']),w(['dsear & fire'])],[],[]).map(o=>o.label)).toEqual(['Dsear','Dsear & Fire']);
 });
 it('prefers the most common saved label and keeps the job’s own label when it matches by key',()=>{
  expect(skillOptions([w(['dsear & fire']),w(['Dsear & Fire']),w(['Dsear & Fire'])],[],[])[0].label).toBe('Dsear & Fire');
  expect(skillOptions([w(['Dsear & Fire'])],['DSEAR & FIRE'],['DSEAR & FIRE'])).toEqual([{label:'DSEAR & FIRE',key:'dsear & fire',held:true}]);
 });
});
