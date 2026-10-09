import {resolveAnnualLeaveOrigin} from '../_shared/annualLeaveOrigins.ts';
import {validateProviderRequirements} from '../rev-scheduling-job-document-analyse/jobDocumentAnalysisBoundary.ts';
export class RequirementConfirmationRefusal extends Error{readonly code:'stale'|'changed';constructor(code:RequirementConfirmationRefusal['code']){super(code);this.code=code;}}
export interface ConfirmationDependencies{allowedOrigin?:string;getUserId(authorization:string):Promise<string|null>;canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;confirm(input:Record<string,unknown>):Promise<unknown>;}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
export async function handleJobRequirementConfirmation(request:Request,deps:ConfirmationDependencies):Promise<Response>{
 const origin=resolveAnnualLeaveOrigin(request.headers.get('Origin'),deps.allowedOrigin);if(!origin)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':origin,Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json'},reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
 const authorization=request.headers.get('Authorization')??'';if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:'Authentication required.'});
 let body:Record<string,unknown>;try{const raw=await request.text();if(raw.length>100000)return reply(400,{error:'Valid requirement confirmation required.'});body=JSON.parse(raw);}catch{return reply(400,{error:'Valid requirement confirmation required.'});}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='analysisId,analysisVersion,expectedCurrentReviewId,expectedCurrentRevision,jobId,requestId,requirements,workspaceId'||!id(body.workspaceId)||!id(body.jobId)||!id(body.analysisId)||!id(body.requestId)||body.analysisVersion!==2||(body.expectedCurrentReviewId!==null&&!id(body.expectedCurrentReviewId))||!Number.isInteger(body.expectedCurrentRevision)||(body.expectedCurrentRevision as number)<0)return reply(400,{error:'Valid requirement confirmation required.'});
 try{validateProviderRequirements(body.requirements);}catch{return reply(400,{error:'Every confirmed requirement needs valid source evidence.'});}
 const userId=await deps.getUserId(authorization);if(!id(userId))return reply(401,{error:'Authentication required.'});
 if(!await deps.canManage(authorization,body.workspaceId as string,userId))return reply(403,{error:'Requirements could not be confirmed.'});
 try{
  const value=await deps.confirm({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_request_id:body.requestId,target_job_id:body.jobId,target_analysis_id:body.analysisId,expected_analysis_version:body.analysisVersion,target_requirements:body.requirements,expected_current_review_id:body.expectedCurrentReviewId,expected_current_revision:body.expectedCurrentRevision});
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid result');const row=value as Record<string,unknown>,createdAt=typeof row.created_at==='string'&&Number.isFinite(Date.parse(row.created_at))?new Date(row.created_at).toISOString():null;
  if(!id(row.review_id)||row.review_id!==body.requestId||row.workspace_id!==body.workspaceId||row.job_id!==body.jobId||row.analysis_id!==body.analysisId||!Number.isInteger(row.job_version)||!Number.isInteger(row.revision)||row.current!==true||!createdAt)throw Error('Invalid result');
  validateProviderRequirements(row.requirements);
  return reply(200,{reviewId:row.review_id,workspaceId:row.workspace_id,jobId:row.job_id,analysisId:row.analysis_id,jobVersion:row.job_version,requirements:row.requirements,revision:row.revision,current:true,createdAt});
 }catch(error){if(error instanceof RequirementConfirmationRefusal)return reply(409,{status:'refused',code:error.code,requestId:body.requestId});return reply(503,{error:'Confirmation outcome could not be confirmed.',code:'outcome_unknown'});}
}
