import {resolveAnnualLeaveOrigin} from '../_shared/annualLeaveOrigins.ts';

export interface JobImportInput{target_workspace_id:string;initiating_user_id:string;target_batch_request_id:string;target_rows:Record<string,unknown>[];}
export interface JobImportDependencies{
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 save(input:JobImportInput):Promise<unknown>;
}
export class JobImportRefusal extends Error{}
export function jobImportRefusalFor(error:unknown){if(!error||typeof error!=='object')return null;const value=error as {code?:unknown;message?:unknown};return value.code==='P0001'&&value.message==='Imported job duplicates existing record'?new JobImportRefusal():null;}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const utc=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const storedInstant=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function validRow(value:unknown):value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const row=value as Record<string,unknown>;
 if(!exact(row,['requestId','title','startAt','endAt','timezone','location','requiredSkills','skillRequirementMode','staffingCount']))return false;
 if(typeof row.requestId!=='string'||!uuid.test(row.requestId)||typeof row.title!=='string'||row.title!==row.title.trim()||row.title.length<1||row.title.length>160||typeof row.startAt!=='string'||!utc.test(row.startAt)||typeof row.endAt!=='string'||!utc.test(row.endAt)||Date.parse(row.startAt)>=Date.parse(row.endAt)||typeof row.timezone!=='string'||!row.timezone||row.timezone!==row.timezone.trim()||row.timezone.length>100||typeof row.location!=='string'||row.location!==row.location.trim()||row.location.length<1||row.location.length>300||!Array.isArray(row.requiredSkills)||row.requiredSkills.length>30||row.requiredSkills.some(skill=>typeof skill!=='string'||!skill||skill!==skill.trim()||skill.length>80)||new Set(row.requiredSkills).size!==row.requiredSkills.length||!['all','any'].includes(row.skillRequirementMode as string)||!Number.isInteger(row.staffingCount)||(row.staffingCount as number)<1||(row.staffingCount as number)>100)return false;
 try{new Intl.DateTimeFormat('en-GB',{timeZone:row.timezone});return true;}catch{return false;}
}
export async function handleSchedulingJobImport(request:Request,deps:JobImportDependencies):Promise<Response>{
 const origin=resolveAnnualLeaveOrigin(request.headers.get('Origin'),deps.allowedOrigin);if(!origin)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':origin,Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json'};const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});const authorization=request.headers.get('Authorization')??'';if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:'Authentication required.'});if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'JSON required.'});
 try{
  const raw=await request.text();if(raw.length>256000)return reply(400,{error:'Invalid job import.'});const body=JSON.parse(raw) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||!exact(body,['workspaceId','batchRequestId','rows'])||typeof body.workspaceId!=='string'||!uuid.test(body.workspaceId)||typeof body.batchRequestId!=='string'||!uuid.test(body.batchRequestId)||!Array.isArray(body.rows)||body.rows.length<1||body.rows.length>100||!body.rows.every(validRow)||new Set(body.rows.map(row=>(row as Record<string,unknown>).requestId)).size!==body.rows.length)return reply(400,{error:'Invalid job import.'});
  const userId=await deps.getUserId(authorization);if(!userId||!uuid.test(userId))return reply(401,{error:'Authentication required.'});if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Job import could not be saved.'});
  const rows=(body.rows as Record<string,unknown>[]).map(row=>({request_id:row.requestId,title:row.title,start_at:row.startAt,end_at:row.endAt,timezone:row.timezone,location:row.location,required_skills:[...(row.requiredSkills as string[])].sort(),skill_requirement_mode:row.skillRequirementMode,staffing_count:row.staffingCount}));
  let result:unknown;try{result=await deps.save({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_batch_request_id:body.batchRequestId,target_rows:rows});}catch(error){if(error instanceof JobImportRefusal)return reply(409,{status:'refused',code:'duplicate_jobs',batchRequestId:body.batchRequestId});throw error;}
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid result');const value=result as Record<string,unknown>;if(value.batch_request_id!==body.batchRequestId||value.workspace_id!==body.workspaceId||value.saved_count!==rows.length||!Array.isArray(value.jobs)||value.jobs.length!==rows.length)throw Error('Invalid result');
  const jobs=value.jobs as Record<string,unknown>[];for(let index=0;index<jobs.length;index++){const job=jobs[index],row=rows[index];if(!job||typeof job!=='object'||Array.isArray(job)||typeof job.job_id!=='string'||!uuid.test(job.job_id)||job.workspace_id!==body.workspaceId||job.title!==row.title||storedInstant(job.start_at)!==row.start_at||storedInstant(job.end_at)!==row.end_at||job.timezone!==row.timezone||job.location!==row.location||JSON.stringify(job.required_skills)!==JSON.stringify(row.required_skills)||job.skill_requirement_mode!==row.skill_requirement_mode||job.staffing_count!==row.staffing_count||job.status!=='open'||job.version!==1)throw Error('Invalid result');}
  return reply(200,{batchRequestId:value.batch_request_id,workspaceId:value.workspace_id,savedCount:value.saved_count,jobs:jobs.map(job=>({jobId:job.job_id}))});
 }catch{return reply(403,{error:'Job import could not be saved.'});}
}
