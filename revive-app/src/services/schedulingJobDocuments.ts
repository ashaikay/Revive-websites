import {workerSuitability,type PlannerData,type PlannerJob,type WorkerSuitabilityReason} from './schedulingPlanner';
import type {SchedulingJob} from './schedulingJobs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256=/^[0-9a-f]{64}$/;
const maxBytes=2*1024*1024;
export const jobDocumentColumns='id,workspace_id,job_id,original_name,mime_type,size_bytes,sha256,status,version,created_at';
export type JobDocumentMime='application/pdf'|'text/plain';
export interface JobDocument{documentId:string;workspaceId:string;jobId:string;originalName:string;mimeType:JobDocumentMime;sizeBytes:number;sha256:string;status:'stored';version:number;createdAt:string;}
export interface JobDocumentUploadAttempt{workspaceId:string;jobId:string;requestId:string;originalName:string;mimeType:JobDocumentMime;sizeBytes:number;sha256:string;base64:string;}
export interface JobDocumentUploadResult extends JobDocument{analysisAvailable:false;}
export interface JobDocumentAccess{workspaceId:string;jobId:string;documentId:string;originalName:string;mimeType:JobDocumentMime;sizeBytes:number;action:'open'|'download';url:string;expiresAt:string;}
interface Storage{getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void;}

function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Job document unavailable');return value as Record<string,unknown>;}
function id(value:unknown):value is string{return typeof value==='string'&&uuid.test(value);}
function instant(value:unknown){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw Error('Job document unavailable');return new Date(value).toISOString();}
function validName(value:unknown){return typeof value==='string'&&value===value.trim()&&value.length>=1&&value.length<=180&&!/[\\/\u0000-\u001f\u007f]/.test(value);}
function validMime(value:unknown):value is JobDocumentMime{return value==='application/pdf'||value==='text/plain';}
function uploadFields(value:Record<string,unknown>){
 if(!id(value.workspaceId)||!id(value.jobId)||!id(value.requestId)||!validName(value.originalName)||!validMime(value.mimeType)||!Number.isInteger(value.sizeBytes)||(value.sizeBytes as number)<1||(value.sizeBytes as number)>maxBytes||typeof value.sha256!=='string'||!sha256.test(value.sha256)||typeof value.base64!=='string'||value.base64.length<1||value.base64.length>2_800_000)throw Error('Valid job document required');
 const extension=(value.originalName as string).toLowerCase().split('.').pop();
 if((value.mimeType==='application/pdf'&&extension!=='pdf')||(value.mimeType==='text/plain'&&extension!=='txt'))throw Error('File name and type do not match');
}
export function validateJobDocumentUpload(value:unknown):JobDocumentUploadAttempt{
 const raw=object(value);
 if(Object.keys(raw).sort().join(',')!=='base64,jobId,mimeType,originalName,requestId,sha256,sizeBytes,workspaceId')throw Error('Valid job document required');
 uploadFields(raw);return raw as unknown as JobDocumentUploadAttempt;
}
function row(value:unknown):JobDocument{
 const raw=object(value);
 if(Object.keys(raw).sort().join(',')!=='createdAt,documentId,jobId,mimeType,originalName,sha256,sizeBytes,status,version,workspaceId'||!id(raw.documentId)||!id(raw.workspaceId)||!id(raw.jobId)||!validName(raw.originalName)||!validMime(raw.mimeType)||!Number.isInteger(raw.sizeBytes)||(raw.sizeBytes as number)<1||(raw.sizeBytes as number)>maxBytes||typeof raw.sha256!=='string'||!sha256.test(raw.sha256)||raw.status!=='stored'||raw.version!==1)throw Error('Job document unavailable');
 return{...raw,createdAt:instant(raw.createdAt)} as unknown as JobDocument;
}
export async function createJobDocumentAttempt(file:File,workspaceId:string,jobId:string,requestId:string):Promise<JobDocumentUploadAttempt>{
 if(!id(workspaceId)||!id(jobId)||!id(requestId)||!validName(file.name)||!validMime(file.type)||file.size<1||file.size>maxBytes)throw Error('Choose a PDF or plain-text file no larger than 2 MB.');
 const extension=file.name.toLowerCase().split('.').pop();if((file.type==='application/pdf'&&extension!=='pdf')||(file.type==='text/plain'&&extension!=='txt'))throw Error('The file extension and reported type do not match.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(file.type==='application/pdf'&&(bytes.length<10||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-'||!new TextDecoder().decode(bytes.slice(Math.max(0,bytes.length-1024))).includes('%%EOF')))throw Error('The PDF signature is invalid or incomplete.');
 if(file.type==='text/plain'){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('The text file is not valid UTF-8.');}if(text.includes('\u0000'))throw Error('The text file contains unsupported binary content.');}
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),hash=[...digest].map(value=>value.toString(16).padStart(2,'0')).join('');
 let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
 return validateJobDocumentUpload({workspaceId,jobId,requestId,originalName:file.name,mimeType:file.type,sizeBytes:file.size,sha256:hash,base64:btoa(binary)});
}
const storageKey=(workspaceId:string,userId:string,jobId:string)=>{if(!id(workspaceId)||!id(userId)||!id(jobId))throw Error('Identity required');return`rev-job-document-upload:${workspaceId}:${userId}:${jobId}`;};
export function rememberJobDocumentUpload(storage:Storage,userId:string,attempt:JobDocumentUploadAttempt){const valid=validateJobDocumentUpload(attempt);storage.setItem(storageKey(valid.workspaceId,userId,valid.jobId),JSON.stringify(valid));}
export function restoreJobDocumentUpload(storage:Storage,workspaceId:string,userId:string,jobId:string){const raw=storage.getItem(storageKey(workspaceId,userId,jobId));if(raw===null)return null;const valid=validateJobDocumentUpload(JSON.parse(raw));if(valid.workspaceId!==workspaceId||valid.jobId!==jobId)throw Error('Pending document upload unavailable');return valid;}
export function clearJobDocumentUpload(storage:Storage,workspaceId:string,userId:string,jobId:string){storage.removeItem(storageKey(workspaceId,userId,jobId));}
export async function submitJobDocumentUpload(attempt:JobDocumentUploadAttempt,invoke:(name:string,body:Record<string,unknown>)=>Promise<{status:number;data:unknown}>):Promise<JobDocumentUploadResult>{
 const valid=validateJobDocumentUpload(attempt),response=await invoke('rev-scheduling-job-document-upload',valid as unknown as Record<string,unknown>);
 if(response.status!==200)throw Error('Upload outcome unconfirmed');
 const raw=object(response.data);if(Object.keys(raw).sort().join(',')!=='analysisAvailable,createdAt,documentId,jobId,mimeType,originalName,sha256,sizeBytes,status,version,workspaceId'||raw.analysisAvailable!==false)throw Error('Upload outcome unconfirmed');
 const document=row(Object.fromEntries(Object.entries(raw).filter(([key])=>key!=='analysisAvailable')));
 if(document.workspaceId!==valid.workspaceId||document.jobId!==valid.jobId||document.originalName!==valid.originalName||document.mimeType!==valid.mimeType||document.sizeBytes!==valid.sizeBytes||document.sha256!==valid.sha256)throw Error('Upload outcome unconfirmed');
 return{...document,analysisAvailable:false};
}
export async function loadJobDocuments(workspaceId:string,jobId:string,read:(columns:string,workspaceId:string,jobId:string)=>Promise<unknown>):Promise<JobDocument[]>{
 if(!id(workspaceId)||!id(jobId))throw Error('Job required');const raw=await read(jobDocumentColumns,workspaceId,jobId);if(!Array.isArray(raw))throw Error('Job documents unavailable');
 const seen=new Set<string>();return raw.map(value=>{const source=object(value);if(Object.keys(source).sort().join(',')!==jobDocumentColumns.split(',').sort().join(','))throw Error('Job documents unavailable');const document=row({documentId:source.id,workspaceId:source.workspace_id,jobId:source.job_id,originalName:source.original_name,mimeType:source.mime_type,sizeBytes:source.size_bytes,sha256:source.sha256,status:source.status,version:source.version,createdAt:source.created_at});if(document.workspaceId!==workspaceId||document.jobId!==jobId||seen.has(document.documentId))throw Error('Job documents unavailable');seen.add(document.documentId);return document;}).sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
}
export async function requestJobDocumentAccess(document:JobDocument,action:'open'|'download',invoke:(name:string,body:Record<string,unknown>)=>Promise<{status:number;data:unknown}>,now=Date.now()):Promise<JobDocumentAccess>{
 const response=await invoke('rev-scheduling-job-document-access',{workspaceId:document.workspaceId,jobId:document.jobId,documentId:document.documentId,action});
 if(response.status===401||response.status===403||response.status===404)throw Error('You no longer have access to this job document.');
 if(response.status!==200)throw Error('A temporary document link could not be created. Try again.');
 const raw=object(response.data),expiresAt=instant(raw.expiresAt);
 if(Object.keys(raw).sort().join(',')!=='action,documentId,expiresAt,jobId,mimeType,originalName,sizeBytes,url,workspaceId'||raw.workspaceId!==document.workspaceId||raw.jobId!==document.jobId||raw.documentId!==document.documentId||raw.originalName!==document.originalName||raw.mimeType!==document.mimeType||raw.sizeBytes!==document.sizeBytes||raw.action!==action||typeof raw.url!=='string'||!/^https?:\/\//.test(raw.url)||Date.parse(expiresAt)<=now)throw Error('The temporary document link could not be verified.');
 return{...raw,expiresAt} as JobDocumentAccess;
}

export interface EvidenceReference{page:number|null;section:string|null;}
export interface EvidenceText{value:string;references:EvidenceReference[];}
export interface ExtractedJobRequirements{tasks:EvidenceText[];requiredSkills:EvidenceText[];qualifications:EvidenceText[];location:EvidenceText|null;dates:EvidenceText[];duration:EvidenceText|null;missingInformation:string[];ambiguities:EvidenceText[];}
function evidence(value:unknown):EvidenceText{
 const raw=object(value);if(Object.keys(raw).sort().join(',')!=='references,value'||typeof raw.value!=='string'||!raw.value.trim()||raw.value!==raw.value.trim()||raw.value.length>500||!Array.isArray(raw.references)||raw.references.length<1||raw.references.length>20)throw Error('Invalid extracted requirement');
 const references=raw.references.map(item=>{const reference=object(item);if(Object.keys(reference).sort().join(',')!=='page,section'||(reference.page!==null&&(!Number.isInteger(reference.page)||(reference.page as number)<1||(reference.page as number)>10000))||(reference.section!==null&&(typeof reference.section!=='string'||!reference.section.trim()||reference.section!==reference.section.trim()||reference.section.length>200))||(reference.page===null&&reference.section===null))throw Error('Invalid evidence reference');return reference as unknown as EvidenceReference;});
 return{value:raw.value,references};
}
export function validateExtractedJobRequirements(value:unknown):ExtractedJobRequirements{
 const raw=object(value);if(Object.keys(raw).sort().join(',')!=='ambiguities,dates,duration,location,missingInformation,qualifications,requiredSkills,tasks')throw Error('Invalid extracted requirements');
 const list=(field:string,max:number)=>{const values=raw[field];if(!Array.isArray(values)||values.length>max)throw Error('Invalid extracted requirements');return values.map(evidence);};
 if(!Array.isArray(raw.missingInformation)||raw.missingInformation.length>20||raw.missingInformation.some(item=>typeof item!=='string'||!item.trim()||item!==item.trim()||item.length>200)||new Set(raw.missingInformation).size!==raw.missingInformation.length)throw Error('Invalid extracted requirements');
 return{tasks:list('tasks',100),requiredSkills:list('requiredSkills',30),qualifications:list('qualifications',30),location:raw.location===null?null:evidence(raw.location),dates:list('dates',30),duration:raw.duration===null?null:evidence(raw.duration),missingInformation:raw.missingInformation as string[],ambiguities:list('ambiguities',30)};
}
export interface ConfirmedJobRequirements{documentId:string;documentVersion:number;jobId:string;jobVersion:number;reviewVersion:number;requirements:ExtractedJobRequirements;}
export interface RequirementRecommendation{workerId:string;suitable:boolean;reason:WorkerSuitabilityReason|'qualifications_unknown'|null;message:string;skillGaps:string[];}
export function recommendWorkersForConfirmedRequirements(data:PlannerData,job:SchedulingJob,confirmed:ConfirmedJobRequirements):RequirementRecommendation[]{
 if(confirmed.jobId!==job.jobId||confirmed.jobVersion!==job.version||confirmed.documentVersion<1||confirmed.reviewVersion<1)throw Error('Requirements are stale. Re-analyse and review the current job and document.');
 const requirements=validateExtractedJobRequirements(confirmed.requirements),plannerJob=data.jobs.find(value=>value.id===job.jobId);if(!plannerJob)throw Error('Current job schedule unavailable');
 const skills=requirements.requiredSkills.map(item=>item.value),candidate:{job:PlannerJob}={job:{...plannerJob,skills}};
 return data.workers.map(worker=>{const result=workerSuitability(data,candidate.job,worker),skillGaps=skills.filter(skill=>!worker.skills.some(held=>held.toLocaleLowerCase()===skill.toLocaleLowerCase()));
  if(requirements.qualifications.length)return{workerId:worker.id,suitable:false,reason:'qualifications_unknown',message:'Required qualifications are present in the document, but worker qualification evidence is not recorded in Scheduling.',skillGaps};
  return{workerId:worker.id,suitable:result.suitable,reason:result.reason,message:result.message,skillGaps};
 });
}

export interface JobDocumentAnalysis{analysisId:string;workspaceId:string;jobId:string;documentId:string;documentVersion:number;jobVersion:number;status:'claimed'|'succeeded'|'failed';version:number;extraction:ExtractedJobRequirements|null;errorCode:string|null;createdAt?:string;}
export interface JobRequirementReview{reviewId:string;workspaceId:string;jobId:string;analysisId:string;jobVersion:number;requirements:ExtractedJobRequirements;revision:number;current:true;createdAt:string;}
export interface AnalysisAttempt{workspaceId:string;jobId:string;documentId:string;documentVersion:1;jobVersion:number;requestId:string;}
export interface ConfirmationAttempt{workspaceId:string;jobId:string;analysisId:string;analysisVersion:2;requirements:ExtractedJobRequirements;expectedCurrentReviewId:string|null;expectedCurrentRevision:number;requestId:string;}
export class DocumentAnalysisUnavailable extends Error{}
export class DocumentAnalysisRefused extends Error{readonly code:string;constructor(code:string){super(code);this.code=code;}}
export class RequirementConfirmationRefused extends Error{readonly code:string;constructor(code:string){super(code);this.code=code;}}
const analysisKey=(workspaceId:string,userId:string,jobId:string)=>`rev-job-document-analysis:${workspaceId}:${userId}:${jobId}`;
const confirmationKey=(workspaceId:string,userId:string,jobId:string)=>`rev-job-requirement-confirm:${workspaceId}:${userId}:${jobId}`;
export function validateAnalysisAttempt(value:unknown):AnalysisAttempt{const raw=object(value);if(Object.keys(raw).sort().join(',')!=='documentId,documentVersion,jobId,jobVersion,requestId,workspaceId'||!id(raw.workspaceId)||!id(raw.jobId)||!id(raw.documentId)||!id(raw.requestId)||raw.documentVersion!==1||!Number.isInteger(raw.jobVersion)||(raw.jobVersion as number)<1)throw Error('Invalid analysis request');return raw as unknown as AnalysisAttempt;}
export function rememberAnalysisAttempt(storage:Storage,userId:string,value:AnalysisAttempt){const attempt=validateAnalysisAttempt(value);storage.setItem(analysisKey(attempt.workspaceId,userId,attempt.jobId),JSON.stringify(attempt));}
export function restoreAnalysisAttempt(storage:Storage,workspaceId:string,userId:string,jobId:string){const raw=storage.getItem(analysisKey(workspaceId,userId,jobId));return raw===null?null:validateAnalysisAttempt(JSON.parse(raw));}
export function clearAnalysisAttempt(storage:Storage,workspaceId:string,userId:string,jobId:string){storage.removeItem(analysisKey(workspaceId,userId,jobId));}
export async function checkDocumentAnalysisAvailability(workspaceId:string,jobId:string,invoke:(name:string,body:Record<string,unknown>)=>Promise<{status:number;data:unknown}>){if(!id(workspaceId)||!id(jobId))throw Error('Job required');const response=await invoke('rev-scheduling-job-document-analyse',{action:'status',workspaceId,jobId});if(response.status!==200)throw Error('Analysis availability unknown');const raw=object(response.data);if(Object.keys(raw).sort().join(',')!=='available,model'||typeof raw.available!=='boolean'||(raw.available?(typeof raw.model!=='string'||!raw.model):raw.model!==null))throw Error('Analysis availability unknown');return raw as {available:boolean;model:string|null};}
function analysisResult(value:unknown):JobDocumentAnalysis{const raw=object(value);if(Object.keys(raw).sort().join(',')!=='analysisId,documentId,documentVersion,errorCode,extraction,jobId,jobVersion,status,version,workspaceId'||!id(raw.analysisId)||!id(raw.workspaceId)||!id(raw.jobId)||!id(raw.documentId)||raw.documentVersion!==1||!Number.isInteger(raw.jobVersion)||!['claimed','succeeded','failed'].includes(raw.status as string)||!Number.isInteger(raw.version))throw Error('Invalid analysis result');return{...raw,extraction:raw.extraction===null?null:validateExtractedJobRequirements(raw.extraction)} as unknown as JobDocumentAnalysis;}
export async function submitAnalysisAttempt(value:AnalysisAttempt,invoke:(name:string,body:Record<string,unknown>)=>Promise<{status:number;data:unknown}>){const attempt=validateAnalysisAttempt(value),response=await invoke('rev-scheduling-job-document-analyse',{action:'analyse',...attempt});if(response.status===503){const raw=object(response.data);if(raw.code==='provider_not_configured'&&raw.requestId===attempt.requestId)throw new DocumentAnalysisUnavailable();throw Error('Analysis outcome unconfirmed');}if(response.status===409||response.status===502){const raw=object(response.data);if(raw.requestId===attempt.requestId&&typeof raw.code==='string')throw new DocumentAnalysisRefused(raw.code);throw Error('Analysis outcome unconfirmed');}if(response.status!==200)throw Error('Analysis outcome unconfirmed');const result=analysisResult(response.data);if(result.analysisId!==attempt.requestId||result.workspaceId!==attempt.workspaceId||result.jobId!==attempt.jobId||result.documentId!==attempt.documentId||result.jobVersion!==attempt.jobVersion||result.status!=='succeeded'||result.version!==2||!result.extraction)throw Error('Analysis outcome unconfirmed');return result;}
export function validateConfirmationAttempt(value:unknown):ConfirmationAttempt{const raw=object(value);if(Object.keys(raw).sort().join(',')!=='analysisId,analysisVersion,expectedCurrentReviewId,expectedCurrentRevision,jobId,requestId,requirements,workspaceId'||!id(raw.workspaceId)||!id(raw.jobId)||!id(raw.analysisId)||!id(raw.requestId)||raw.analysisVersion!==2||(raw.expectedCurrentReviewId!==null&&!id(raw.expectedCurrentReviewId))||!Number.isInteger(raw.expectedCurrentRevision)||(raw.expectedCurrentRevision as number)<0)throw Error('Invalid confirmation request');return{...raw,requirements:validateExtractedJobRequirements(raw.requirements)} as unknown as ConfirmationAttempt;}
export function rememberConfirmationAttempt(storage:Storage,userId:string,value:ConfirmationAttempt){const attempt=validateConfirmationAttempt(value);storage.setItem(confirmationKey(attempt.workspaceId,userId,attempt.jobId),JSON.stringify(attempt));}
export function restoreConfirmationAttempt(storage:Storage,workspaceId:string,userId:string,jobId:string){const raw=storage.getItem(confirmationKey(workspaceId,userId,jobId));return raw===null?null:validateConfirmationAttempt(JSON.parse(raw));}
export function clearConfirmationAttempt(storage:Storage,workspaceId:string,userId:string,jobId:string){storage.removeItem(confirmationKey(workspaceId,userId,jobId));}
function reviewResult(value:unknown):JobRequirementReview{const raw=object(value);if(Object.keys(raw).sort().join(',')!=='analysisId,createdAt,current,jobId,jobVersion,requirements,reviewId,revision,workspaceId'||!id(raw.reviewId)||!id(raw.workspaceId)||!id(raw.jobId)||!id(raw.analysisId)||!Number.isInteger(raw.jobVersion)||!Number.isInteger(raw.revision)||raw.current!==true)throw Error('Invalid requirement review');return{...raw,createdAt:instant(raw.createdAt),requirements:validateExtractedJobRequirements(raw.requirements)} as unknown as JobRequirementReview;}
export async function submitConfirmationAttempt(value:ConfirmationAttempt,invoke:(name:string,body:Record<string,unknown>)=>Promise<{status:number;data:unknown}>){const attempt=validateConfirmationAttempt(value),response=await invoke('rev-scheduling-job-requirements-confirm',attempt as unknown as Record<string,unknown>);if(response.status===409){const raw=object(response.data);if(raw.requestId===attempt.requestId&&typeof raw.code==='string')throw new RequirementConfirmationRefused(raw.code);throw Error('Confirmation outcome unconfirmed');}if(response.status!==200)throw Error('Confirmation outcome unconfirmed');const review=reviewResult(response.data);if(review.reviewId!==attempt.requestId||review.workspaceId!==attempt.workspaceId||review.jobId!==attempt.jobId||review.analysisId!==attempt.analysisId||review.revision!==attempt.expectedCurrentRevision+1)throw Error('Confirmation outcome unconfirmed');return review;}
export const analysisColumns='id,workspace_id,job_id,document_id,document_version,job_version,status,version,extraction,error_code,created_at';
export const reviewColumns='id,workspace_id,job_id,analysis_id,job_version,requirements,revision,current,created_at';
export async function loadJobDocumentAnalyses(workspaceId:string,jobId:string,read:(columns:string,workspaceId:string,jobId:string)=>Promise<unknown>):Promise<JobDocumentAnalysis[]>{if(!id(workspaceId)||!id(jobId))throw Error('Job required');const raw=await read(analysisColumns,workspaceId,jobId);if(!Array.isArray(raw))throw Error('Analyses unavailable');return raw.map(value=>{const row=object(value),analysis=analysisResult({analysisId:row.id,workspaceId:row.workspace_id,jobId:row.job_id,documentId:row.document_id,documentVersion:row.document_version,jobVersion:row.job_version,status:row.status,version:row.version,extraction:row.extraction,errorCode:row.error_code});if(analysis.workspaceId!==workspaceId||analysis.jobId!==jobId)throw Error('Analyses unavailable');return{...analysis,createdAt:instant(row.created_at)};}).sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??''));}
export async function loadCurrentRequirementReview(workspaceId:string,jobId:string,read:(columns:string,workspaceId:string,jobId:string)=>Promise<unknown>):Promise<JobRequirementReview|null>{if(!id(workspaceId)||!id(jobId))throw Error('Job required');const raw=await read(reviewColumns,workspaceId,jobId);if(!Array.isArray(raw)||raw.length>1)throw Error('Review unavailable');if(!raw.length)return null;const row=object(raw[0]),review=reviewResult({reviewId:row.id,workspaceId:row.workspace_id,jobId:row.job_id,analysisId:row.analysis_id,jobVersion:row.job_version,requirements:row.requirements,revision:row.revision,current:row.current,createdAt:row.created_at});if(review.workspaceId!==workspaceId||review.jobId!==jobId)throw Error('Review unavailable');return review;}
