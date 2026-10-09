import {resolveAnnualLeaveOrigin} from '../_shared/annualLeaveOrigins.ts';
import {DocumentProviderFailure,type ProviderExtraction,type ProviderJobContext} from './openAiJobDocumentProvider.ts';

export interface AnalysisClaim{analysis_id:string;workspace_id:string;job_id:string;document_id:string;document_version:number;job_version:number;status:'claimed'|'succeeded'|'failed';version:number;should_attempt:boolean;extraction:unknown;error_code:string|null;}
export interface AnalysisSource{filename:string;mimeType:'application/pdf'|'text/plain';base64:string;job:ProviderJobContext;}
export interface AnalysisDependencies{
 allowedOrigin?:string;providerConfigured:boolean;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 claim(input:Record<string,unknown>):Promise<unknown>;
 source(workspaceId:string,jobId:string,documentId:string):Promise<AnalysisSource>;
 analyse(source:AnalysisSource):Promise<ProviderExtraction>;
 complete(input:Record<string,unknown>):Promise<unknown>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
function evidence(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid evidence');const item=value as Record<string,unknown>;
 if(Object.keys(item).sort().join(',')!=='references,value'||typeof item.value!=='string'||!item.value.trim()||item.value!==item.value.trim()||item.value.length>500||!Array.isArray(item.references)||item.references.length<1||item.references.length>20)throw Error('Invalid evidence');
 for(const raw of item.references){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid reference');const ref=raw as Record<string,unknown>;if(Object.keys(ref).sort().join(',')!=='page,section'||(ref.page!==null&&(!Number.isInteger(ref.page)||(ref.page as number)<1||(ref.page as number)>10000))||(ref.section!==null&&(typeof ref.section!=='string'||!ref.section.trim()||ref.section!==ref.section.trim()||ref.section.length>200))||(ref.page===null&&ref.section===null))throw Error('Invalid reference');}
}
export function validateProviderRequirements(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid requirements');const raw=value as Record<string,unknown>;
 if(Object.keys(raw).sort().join(',')!=='ambiguities,dates,duration,location,missingInformation,qualifications,requiredSkills,tasks')throw Error('Invalid requirements');
 for(const [field,max] of [['tasks',100],['requiredSkills',30],['qualifications',30],['dates',30],['ambiguities',30]] as const){const list=raw[field];if(!Array.isArray(list)||list.length>max)throw Error('Invalid requirements');list.forEach(evidence);}
 if(raw.location!==null)evidence(raw.location);if(raw.duration!==null)evidence(raw.duration);
 if(!Array.isArray(raw.missingInformation)||raw.missingInformation.length>20||raw.missingInformation.some(item=>typeof item!=='string'||!item.trim()||item!==item.trim()||item.length>200)||new Set(raw.missingInformation).size!==raw.missingInformation.length)throw Error('Invalid requirements');
 return raw;
}
function claim(value:unknown,body:Record<string,unknown>):AnalysisClaim{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid claim');const row=value as Record<string,unknown>;
 if(!id(row.analysis_id)||row.analysis_id!==body.requestId||row.workspace_id!==body.workspaceId||row.job_id!==body.jobId||row.document_id!==body.documentId||row.document_version!==body.documentVersion||row.job_version!==body.jobVersion||!['claimed','succeeded','failed'].includes(row.status as string)||!Number.isInteger(row.version)||typeof row.should_attempt!=='boolean')throw Error('Invalid claim');
 return row as unknown as AnalysisClaim;
}
const publicResult=(value:AnalysisClaim)=>({analysisId:value.analysis_id,workspaceId:value.workspace_id,jobId:value.job_id,documentId:value.document_id,documentVersion:value.document_version,jobVersion:value.job_version,status:value.status,version:value.version,extraction:value.extraction,errorCode:value.error_code});
export async function handleJobDocumentAnalysis(request:Request,deps:AnalysisDependencies):Promise<Response>{
 const origin=resolveAnnualLeaveOrigin(request.headers.get('Origin'),deps.allowedOrigin);if(!origin)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':origin,Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json'},reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
 const authorization=request.headers.get('Authorization')??'';if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:'Authentication required.'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'JSON required.'});
 let body:Record<string,unknown>;try{const raw=await request.text();if(raw.length>2048)return reply(400,{error:'Valid analysis request required.'});body=JSON.parse(raw);}catch{return reply(400,{error:'Valid analysis request required.'});}
 if(!body||typeof body!=='object'||Array.isArray(body)||!id(body.workspaceId)||!id(body.jobId))return reply(400,{error:'Valid analysis request required.'});
 const userId=await deps.getUserId(authorization);if(!id(userId))return reply(401,{error:'Authentication required.'});
 if(!await deps.canManage(authorization,body.workspaceId as string,userId))return reply(403,{error:'Job document analysis unavailable.'});
 if(body.action==='status'&&Object.keys(body).sort().join(',')==='action,jobId,workspaceId')return reply(200,{available:deps.providerConfigured,model:deps.providerConfigured?'gpt-4.1-mini-2025-04-14':null});
 if(Object.keys(body).sort().join(',')!=='action,documentId,documentVersion,jobId,jobVersion,requestId,workspaceId'||body.action!=='analyse'||!id(body.documentId)||!id(body.requestId)||body.documentVersion!==1||!Number.isInteger(body.jobVersion)||(body.jobVersion as number)<1)return reply(400,{error:'Valid analysis request required.'});
 if(!deps.providerConfigured)return reply(503,{status:'unavailable',code:'provider_not_configured',requestId:body.requestId});
 let claimed:AnalysisClaim;
 try{claimed=claim(await deps.claim({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_request_id:body.requestId,target_job_id:body.jobId,target_document_id:body.documentId,expected_document_version:body.documentVersion,expected_job_version:body.jobVersion}),body);}catch{return reply(409,{status:'refused',code:'stale_or_changed',requestId:body.requestId});}
 if(!claimed.should_attempt){
  if(claimed.status==='succeeded')return reply(200,publicResult(claimed));
  if(claimed.status==='failed')return reply(409,{...publicResult(claimed),code:claimed.error_code,requestId:body.requestId});
  return reply(202,{...publicResult(claimed),requestId:body.requestId});
 }
 try{
  const source=await deps.source(body.workspaceId as string,body.jobId as string,body.documentId as string),provider=await deps.analyse(source),requirements=validateProviderRequirements(provider.requirements);
  const completed=claim(await deps.complete({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_analysis_id:body.requestId,target_status:'succeeded',target_extraction:requirements,target_error_code:null,target_provider_response_id:provider.providerResponseId,target_input_tokens:provider.inputTokens,target_output_tokens:provider.outputTokens}),{...body,requestId:body.requestId});
  return reply(200,publicResult(completed));
 }catch(error){
  const code=error instanceof DocumentProviderFailure?(error.code==='refused'?'provider_refused':error.code==='invalid_response'?'invalid_response':'provider_unavailable'):'provider_unavailable';
  try{await deps.complete({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_analysis_id:body.requestId,target_status:'failed',target_extraction:null,target_error_code:code,target_provider_response_id:null,target_input_tokens:null,target_output_tokens:null});}catch{return reply(503,{status:'unknown',code:'analysis_outcome_unknown',requestId:body.requestId});}
  return reply(502,{status:'failed',code,requestId:body.requestId});
 }
}
