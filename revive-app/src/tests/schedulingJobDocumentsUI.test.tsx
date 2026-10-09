// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {SchedulingJobDocumentsPanel} from '@/components/SchedulingJobDocumentsPanel';
import type {SchedulingJob} from '@/services/schedulingJobs';

const mocks=vi.hoisted(()=>({rows:{} as Record<string,unknown[]>,invoke:vi.fn()}));
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{from:(table:string)=>({select:()=>{const query={eq:()=>query,order:async()=>({data:structuredClone(mocks.rows[table]??[]),error:null})};return query;}}),functions:{invoke:mocks.invoke}}}));
const job:SchedulingJob={jobId:'22222222-2222-4222-8222-222222222222',workspaceId:'11111111-1111-4111-8111-111111111111',title:'Support',startAt:'2026-10-12T08:00:00.000Z',endAt:'2026-10-12T16:00:00.000Z',timezone:'Europe/London',location:'Office',requiredSkills:['First aid'],skillRequirementMode:'all',staffingCount:1,status:'open',version:1};
describe('Scheduling job documents UI',()=>{
 afterEach(()=>{cleanup();window.sessionStorage.clear();vi.clearAllMocks();mocks.rows={};});
 it('shows supported upload constraints and explicit unavailable AI state without fake results',async()=>{
  mocks.invoke.mockResolvedValue({data:{available:false,model:null},error:null});
  render(<SchedulingJobDocumentsPanel workspaceId={job.workspaceId} userId="33333333-3333-4333-8333-333333333333" job={job} disabled={false}/>);
  fireEvent.click(screen.getByText('Job documents and requirement review'));
  expect(await screen.findByText('AI analysis unavailable.')).toBeVisible();
  expect(screen.getByText(/never instructions/)).toBeVisible();
  expect(screen.getByLabelText('Choose document for Support')).toHaveAttribute('accept',expect.stringContaining('.pdf'));
  expect(screen.queryByRole('button',{name:/assign/i})).not.toBeInTheDocument();
  await waitFor(()=>expect(screen.getByText('No job documents stored.')).toBeVisible());
 });
 it('shows cited extraction separately and requires explicit manager confirmation',async()=>{
  const documentId='44444444-4444-4444-8444-444444444444',userId='33333333-3333-4333-8333-333333333333';
  const extraction={tasks:[{value:'Support customers',references:[{page:1,section:null}]}],requiredSkills:[{value:'First aid',references:[{page:2,section:'Skills'}]}],qualifications:[],location:null,dates:[],duration:null,missingInformation:['Duration'],ambiguities:[]};
  mocks.rows.scheduling_job_documents=[{id:documentId,workspace_id:job.workspaceId,job_id:job.jobId,original_name:'brief.pdf',mime_type:'application/pdf',size_bytes:100,sha256:'a'.repeat(64),status:'stored',version:1,created_at:'2026-10-12T09:00:00.000Z'}];
  mocks.invoke.mockImplementation(async(_name:string,{body}:{body:Record<string,unknown>})=>body.action==='status'?{data:{available:true,model:'gpt-4.1-mini-2025-04-14'},error:null}:body.action==='analyse'?{data:{analysisId:body.requestId,workspaceId:job.workspaceId,jobId:job.jobId,documentId,documentVersion:1,jobVersion:1,status:'succeeded',version:2,extraction,errorCode:null},error:null}:{data:{reviewId:body.requestId,workspaceId:job.workspaceId,jobId:job.jobId,analysisId:body.analysisId,jobVersion:2,requirements:extraction,revision:1,current:true,createdAt:'2026-10-12T10:00:00.000Z'},error:null});
  render(<SchedulingJobDocumentsPanel workspaceId={job.workspaceId} userId={userId} job={job} disabled={false}/>);
  fireEvent.click(screen.getByText('Job documents and requirement review'));
  fireEvent.click(await screen.findByRole('button',{name:'ANALYSE DOCUMENT'}));
  expect(await screen.findByText('Support customers')).toBeVisible();
  expect(screen.getByText('(page 2, section “Skills”)')).toBeVisible();
  expect(screen.getByText(/Missing information:/).parentElement).toHaveTextContent('Duration');
  expect(screen.getByText('No requirements confirmed.')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'CONFIRM REVIEWED REQUIREMENTS'}));
  expect(await screen.findByText('Review revision 1. These are separate from the AI extraction and are the current recommendation evidence.')).toBeVisible();
  expect(screen.queryByRole('button',{name:/assign worker/i})).not.toBeInTheDocument();
 });
});
