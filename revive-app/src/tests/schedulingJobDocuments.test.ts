// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {DocumentAnalysisRefused,DocumentAnalysisUnavailable,recommendWorkersForConfirmedRequirements,requestJobDocumentAccess,submitAnalysisAttempt,submitConfirmationAttempt,validateExtractedJobRequirements,validateJobDocumentUpload,type JobDocument} from '@/services/schedulingJobDocuments';
import type {PlannerData} from '@/services/schedulingPlanner';
import type {SchedulingJob} from '@/services/schedulingJobs';

const workspaceId='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222',documentId='33333333-3333-4333-8333-333333333333';
const evidence=(value:string)=>({value,references:[{page:1,section:'Requirements'}]});
const requirements={tasks:[evidence('Support customers')],requiredSkills:[evidence('First aid')],qualifications:[],location:null,dates:[],duration:null,missingInformation:['Location not stated'],ambiguities:[evidence('Duration could refer to each shift or the full contract')]};
const job:SchedulingJob={jobId,workspaceId,title:'Support',startAt:'2026-10-12T08:00:00.000Z',endAt:'2026-10-12T16:00:00.000Z',timezone:'Europe/London',location:'Office',requiredSkills:[],skillRequirementMode:'all',staffingCount:2,status:'open',version:3};
const data:PlannerData={
 workers:[{id:'44444444-4444-4444-8444-444444444444',name:'Ready',active:true,skills:['First aid']},{id:'55555555-5555-4555-8555-555555555555',name:'Busy',active:true,skills:['First aid']},{id:'66666666-6666-4666-8666-666666666666',name:'Gap',active:true,skills:[]}],
 jobs:[{id:jobId,title:job.title,startAt:job.startAt,endAt:job.endAt,timezone:job.timezone,location:job.location,skills:[],skillRequirementMode:'all',count:2,status:'open'}],
 assignments:[{id:'77777777-7777-4777-8777-777777777777',workerId:'55555555-5555-4555-8555-555555555555',jobId,startAt:job.startAt,endAt:job.endAt,status:'active'}],
 patterns:dataPatterns(),leave:[],
};
function dataPatterns(){return['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'].map(workerId=>({workerId,timezone:'Europe/London',days:[1],startLocal:'09:00',endLocal:'17:00',from:'2026-01-01',until:null}));}

describe('Scheduling job documents and extracted requirements',()=>{
 it('requires evidence references and preserves missing and ambiguous information',()=>{
  expect(validateExtractedJobRequirements(requirements)).toEqual(requirements);
  expect(()=>validateExtractedJobRequirements({...requirements,requiredSkills:[{value:'Invented',references:[]}]})).toThrow(/requirement/);
 });
 it('extends deterministic suitability with skill gaps and scheduling conflicts',()=>{
  const confirmed={documentId,documentVersion:1,jobId,jobVersion:3,reviewVersion:1,requirements};
  const recommendations=recommendWorkersForConfirmedRequirements(data,job,confirmed);
  expect(recommendations.find(value=>value.workerId.startsWith('4444'))).toMatchObject({suitable:true,skillGaps:[]});
  expect(recommendations.find(value=>value.workerId.startsWith('5555'))).toMatchObject({suitable:false,reason:'overlap'});
  expect(recommendations.find(value=>value.workerId.startsWith('6666'))).toMatchObject({suitable:false,reason:'missing_skills',skillGaps:['First aid']});
 });
 it('keeps qualifications unknown and rejects stale confirmed requirements',()=>{
  const qualified={...requirements,qualifications:[evidence('Level 3 certificate')]};
  expect(recommendWorkersForConfirmedRequirements(data,job,{documentId,documentVersion:1,jobId,jobVersion:3,reviewVersion:1,requirements:qualified}).every(value=>value.reason==='qualifications_unknown')).toBe(true);
  expect(()=>recommendWorkersForConfirmedRequirements(data,job,{documentId,documentVersion:1,jobId,jobVersion:2,reviewVersion:1,requirements})).toThrow(/stale/i);
 });
 it('binds retained uploads to exact file metadata and keeps storage service-only',()=>{
  expect(()=>validateJobDocumentUpload({workspaceId,jobId,requestId:documentId,originalName:'brief.txt',mimeType:'text/plain',sizeBytes:4,sha256:'a'.repeat(64),base64:'dGVzdA==',extra:true})).toThrow();
  const migration=readFileSync(resolve('supabase/migrations/20261010233000_rev_scheduling_job_documents.sql'),'utf8');
  expect(migration).toContain("public.has_workspace_role(workspace_id,array['owner','admin'])");
  expect(migration).toContain('grant execute on function public.save_rev_scheduling_job_document');
  expect(migration).toContain('to service_role');
  expect(migration).not.toContain('grant insert on public.scheduling_job_documents to authenticated');
  expect(migration).toContain('return previous.result');
 });
 it('distinguishes disabled, refused and unconfirmed analysis outcomes',async()=>{
  const attempt={workspaceId,jobId,documentId,documentVersion:1 as const,jobVersion:3,requestId:'77777777-7777-4777-8777-777777777777'};
  await expect(submitAnalysisAttempt(attempt,async()=>({status:503,data:{code:'provider_not_configured',requestId:attempt.requestId}}))).rejects.toBeInstanceOf(DocumentAnalysisUnavailable);
  await expect(submitAnalysisAttempt(attempt,async()=>({status:502,data:{code:'provider_refused',requestId:attempt.requestId}}))).rejects.toBeInstanceOf(DocumentAnalysisRefused);
  await expect(submitAnalysisAttempt(attempt,async()=>({status:202,data:{status:'claimed',requestId:attempt.requestId}}))).rejects.toThrow(/unconfirmed/i);
 });
 it('validates successful analysis and manager confirmation identities',async()=>{
  const analysisId='77777777-7777-4777-8777-777777777777',attempt={workspaceId,jobId,documentId,documentVersion:1 as const,jobVersion:3,requestId:analysisId};
  await expect(submitAnalysisAttempt(attempt,async()=>({status:200,data:{analysisId,workspaceId,jobId,documentId,documentVersion:1,jobVersion:3,status:'succeeded',version:2,extraction:requirements,errorCode:null}}))).resolves.toMatchObject({analysisId,status:'succeeded'});
  const confirmation={workspaceId,jobId,analysisId,analysisVersion:2 as const,requirements,expectedCurrentReviewId:null,expectedCurrentRevision:0,requestId:'88888888-8888-4888-8888-888888888888'};
  await expect(submitConfirmationAttempt(confirmation,async()=>({status:200,data:{reviewId:confirmation.requestId,workspaceId,jobId,analysisId,jobVersion:4,requirements,revision:1,current:true,createdAt:'2026-10-12T10:00:00.000Z'}}))).resolves.toMatchObject({jobVersion:4,revision:1});
 });
 it('makes confirmed skills canonical and blocks assignment when qualifications remain unknown',()=>{
  const migration=readFileSync(resolve('supabase/migrations/20261010234000_rev_scheduling_job_document_analysis.sql'),'utf8');
  expect(migration).toContain('set required_skills=confirmed_skills,version=value.version+1');
  expect(migration).toContain("raise exception 'Worker qualification evidence required'");
  expect(migration).toContain('where review.workspace_id=new.workspace_id and review.job_id=new.job_id and review.current');
 });
 it('validates short-lived document access against the exact workspace, job and metadata',async()=>{
  const document:JobDocument={documentId,workspaceId,jobId,originalName:'brief.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:'a'.repeat(64),status:'stored',version:1,createdAt:'2026-10-10T00:00:00.000Z'},expiresAt='2026-10-10T00:01:00.000Z';
  await expect(requestJobDocumentAccess(document,'open',async()=>({status:200,data:{workspaceId,jobId,documentId,originalName:'brief.pdf',mimeType:'application/pdf',sizeBytes:100,action:'open',url:'https://storage.test/one',expiresAt}}),Date.parse('2026-10-10T00:00:00.000Z'))).resolves.toMatchObject({url:'https://storage.test/one',action:'open'});
  await expect(requestJobDocumentAccess(document,'open',async()=>({status:200,data:{workspaceId,jobId:'99999999-9999-4999-8999-999999999999',documentId,originalName:'brief.pdf',mimeType:'application/pdf',sizeBytes:100,action:'open',url:'https://storage.test/two',expiresAt}}),Date.parse('2026-10-10T00:00:00.000Z'))).rejects.toThrow(/verified/);
  await expect(requestJobDocumentAccess(document,'open',async()=>({status:403,data:{error:'denied'}}))).rejects.toThrow(/no longer have access/);
 });
 it('requests a fresh link after expiry instead of retaining signed URLs',async()=>{
  const document:JobDocument={documentId,workspaceId,jobId,originalName:'brief.txt',mimeType:'text/plain',sizeBytes:4,sha256:'a'.repeat(64),status:'stored',version:1,createdAt:'2026-10-10T00:00:00.000Z'};let requests=0;
  const invoke=async()=>({status:200,data:{workspaceId,jobId,documentId,originalName:'brief.txt',mimeType:'text/plain',sizeBytes:4,action:'open',url:`https://storage.test/${++requests}`,expiresAt:new Date(Date.parse('2026-10-10T00:00:00.000Z')+requests*60000).toISOString()}});
  const first=await requestJobDocumentAccess(document,'open',invoke,Date.parse('2026-10-10T00:00:00.000Z')),second=await requestJobDocumentAccess(document,'open',invoke,Date.parse('2026-10-10T00:01:00.000Z'));
  expect(first.url).not.toBe(second.url);expect(requests).toBe(2);
 });
});
