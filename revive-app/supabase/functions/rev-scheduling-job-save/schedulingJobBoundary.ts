import { resolveAnnualLeaveOrigin } from '../_shared/annualLeaveOrigins.ts';

export interface JobInput {
 target_workspace_id:string;initiating_user_id:string;target_request_id:string;target_job_id:string|null;
 target_title:string;target_start_at:string;target_end_at:string;target_timezone:string;target_location:string;target_required_skills:string[];target_staffing_count:number;target_status:string;expected_version:number;
 target_skill_requirement_mode:'all'|'any';
}
export interface JobDependencies {
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 save(input:JobInput):Promise<unknown>;
}
export type JobSaveRefusalCode='active_assignments';
export class JobSaveRefusal extends Error{readonly code:JobSaveRefusalCode;constructor(code:JobSaveRefusalCode){super(code);this.code=code;}}
// Only the assignment guard's own raise (SQLSTATE P0001 with its exact message) is a definitive refusal; every other database error stays unconfirmed.
export function jobSaveRefusalFor(error:unknown):JobSaveRefusal|null{if(!error||typeof error!=='object')return null;const e=error as {code?:unknown;message?:unknown};return e.code==='P0001'&&e.message==='Cancel affected assignments before changing job'?new JobSaveRefusal('active_assignments'):null;}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
function utc(v:unknown):v is string{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))return false;const ms=Date.parse(v);return Number.isFinite(ms)&&new Date(ms).toISOString()===v;}
function storedInstant(v:unknown):string|null{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v))return null;const ms=Date.parse(v);return Number.isFinite(ms)?new Date(ms).toISOString():null;}
function validTimezone(v:unknown):v is string{if(typeof v!=='string'||!v||v!==v.trim()||v.length>100)return false;try{new Intl.DateTimeFormat('en-GB',{timeZone:v});return true;}catch{return false;}}
function validSkills(v:unknown):v is string[]{return Array.isArray(v)&&v.length<=30&&v.every(t=>typeof t==='string'&&t.length>0&&t.length<=80&&t===t.trim())&&new Set(v).size===v.length;}
function validSkillRequirementMode(v:unknown):v is 'all'|'any'{return v==='all'||v==='any';}
export async function handleSchedulingJobSave(request:Request,deps:JobDependencies):Promise<Response>{
 const origin=resolveAnnualLeaveOrigin(request.headers.get('Origin'),deps.allowedOrigin);
 if(!origin)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':origin,Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
 const authorization=request.headers.get('Authorization')??'';
 if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:'Authentication required.'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'JSON required.'});
 try{
  const raw=await request.text();if(raw.length>8192)return reply(400,{error:'Invalid job.'});const body=JSON.parse(raw);
  const legacyKeys='endAt,expectedVersion,jobId,location,requestId,requiredSkills,staffingCount,startAt,status,timezone,title,workspaceId';
  const requestKeys='endAt,expectedVersion,jobId,location,requestId,requiredSkills,skillRequirementMode,staffingCount,startAt,status,timezone,title,workspaceId';
  if(!body||typeof body!=='object'||Array.isArray(body)||(Object.keys(body).sort().join(',')!==legacyKeys&&Object.keys(body).sort().join(',')!==requestKeys)
   ||(body.skillRequirementMode!==undefined&&!validSkillRequirementMode(body.skillRequirementMode))
   ||!id(body.workspaceId)||!id(body.requestId)||(body.jobId!==null&&!id(body.jobId))
   ||!utc(body.startAt)||!utc(body.endAt)||Date.parse(body.startAt)>=Date.parse(body.endAt)
   ||typeof body.title!=='string'||body.title!==body.title.trim()||body.title.length<1||body.title.length>160
   ||typeof body.location!=='string'||body.location!==body.location.trim()||body.location.length<1||body.location.length>300
   ||!validTimezone(body.timezone)||!validSkills(body.requiredSkills)
   ||!Number.isInteger(body.staffingCount)||body.staffingCount<1||body.staffingCount>100||!['open','cancelled'].includes(body.status)
   ||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||body.expectedVersion>=Number.MAX_SAFE_INTEGER
   ||(body.jobId===null?(body.expectedVersion!==0||body.status!=='open'):body.expectedVersion===0))return reply(400,{error:'Invalid job.'});
  const skillRequirementMode=body.skillRequirementMode??'all';
  const userId=await deps.getUserId(authorization);if(!id(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Job could not be saved.'});
  const skills=[...body.requiredSkills].sort();
  let value:unknown;try{value=await deps.save({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_request_id:body.requestId,target_job_id:body.jobId,target_title:body.title,target_start_at:body.startAt,target_end_at:body.endAt,target_timezone:body.timezone,target_location:body.location,target_required_skills:skills,target_skill_requirement_mode:skillRequirementMode,target_staffing_count:body.staffingCount,target_status:body.status,expected_version:body.expectedVersion});}
  // The database guard rolled back the whole request, so this refusal is definitive and bound to this request.
  catch(error){if(error instanceof JobSaveRefusal)return reply(409,{status:'refused',code:error.code,requestId:body.requestId});throw error;}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid result');const row=value as Record<string,unknown>;
  const returnedMode=row.skill_requirement_mode??'all';
  if(!id(row.job_id)||(body.jobId!==null&&row.job_id!==body.jobId)||row.workspace_id!==body.workspaceId||storedInstant(row.start_at)!==body.startAt||storedInstant(row.end_at)!==body.endAt||row.title!==body.title||row.timezone!==body.timezone||row.location!==body.location||JSON.stringify(row.required_skills)!==JSON.stringify(skills)||returnedMode!==skillRequirementMode||row.staffing_count!==body.staffingCount||row.status!==body.status||row.version!==body.expectedVersion+1)throw new Error('Invalid result');
  return reply(200,{jobId:row.job_id,workspaceId:row.workspace_id,title:row.title,startAt:body.startAt,endAt:body.endAt,timezone:row.timezone,location:row.location,requiredSkills:skills,skillRequirementMode,staffingCount:row.staffing_count,status:row.status,version:row.version});
 }catch{return reply(403,{error:'Job could not be saved.'});}
}
