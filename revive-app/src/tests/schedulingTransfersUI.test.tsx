// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {SchedulingTransfersPanel} from '@/components/SchedulingTransfersPanel';
import {jobImportTemplate} from '@/services/schedulingTransfers';
import type {PlannerData} from '@/services/schedulingPlanner';

const workspaceId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const ids=['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{functions:{invoke:mocks.invoke}}}));
const data:PlannerData={workers:[],jobs:[],assignments:[],patterns:[],leave:[]};

describe('Scheduling transfer controls',()=>{
 beforeEach(()=>{window.sessionStorage.clear();mocks.invoke.mockReset();let index=0;vi.stubGlobal('crypto',{randomUUID:()=>ids[Math.min(index++,ids.length-1)]});});
 afterEach(()=>{cleanup();vi.unstubAllGlobals();});
 it('previews the job template and requires explicit confirmation',async()=>{
  mocks.invoke.mockResolvedValue({data:{batchRequestId:ids[1],workspaceId,savedCount:1,jobs:[{job_id:'55555555-5555-4555-8555-555555555555'}]},error:null});
  render(<SchedulingTransfersPanel workspaceId={workspaceId} userId={userId} data={data} startDate="2026-10-05" endDate="2026-10-11" timezone="Europe/London" workerId="" location="" periodLabel="WEEK" stale={false}/>);
  fireEvent.click(screen.getByText('Schedule downloads and job CSV upload'));
  const file={text:async()=>jobImportTemplate()} as File;
  fireEvent.change(screen.getByLabelText('Choose completed job CSV'),{target:{files:[file]}});
  expect(await screen.findByText('Example support shift')).toBeInTheDocument();
  expect(mocks.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'CONFIRM AND SAVE JOBS'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
  expect(mocks.invoke.mock.calls[0][0]).toBe('rev-scheduling-job-import');
  expect(await screen.findByText(/1 job record saved/)).toBeVisible();
 });

 it('retains an uncertain batch and retries the exact request without duplicate rows',async()=>{
  mocks.invoke.mockResolvedValueOnce({data:null,error:new Error('network')});
  render(<SchedulingTransfersPanel workspaceId={workspaceId} userId={userId} data={data} startDate="2026-10-05" endDate="2026-10-11" timezone="Europe/London" workerId="" location="" periodLabel="WEEK" stale={false}/>);
  fireEvent.click(screen.getByText('Schedule downloads and job CSV upload'));
  fireEvent.change(screen.getByLabelText('Choose completed job CSV'),{target:{files:[{text:async()=>jobImportTemplate()}]}});
  fireEvent.click(await screen.findByRole('button',{name:'CONFIRM AND SAVE JOBS'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('exact request IDs');
  const first=mocks.invoke.mock.calls[0][1].body;
  mocks.invoke.mockResolvedValueOnce({data:{batchRequestId:first.batchRequestId,workspaceId,savedCount:1,jobs:[{job_id:'55555555-5555-4555-8555-555555555555'}]},error:null});
  fireEvent.click(screen.getByRole('button',{name:'RETRY SAME JOB IMPORT'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(2));
  expect(mocks.invoke.mock.calls[1][1].body).toEqual(first);
  expect(window.sessionStorage.getItem(`rev-job-import:${workspaceId}:${userId}`)).toBeNull();
 });
});
