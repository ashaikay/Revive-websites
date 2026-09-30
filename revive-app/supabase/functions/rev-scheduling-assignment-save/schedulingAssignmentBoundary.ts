export interface AssignmentInput{target_workspace_id:string;initiating_user_id:string;target_request_id:string;target_assignment_id:string|null;target_worker_id:string;target_job_id:string;target_status:string;expected_version:number;expected_worker_version:number|null;expected_job_version:number|null;expected_pattern_version:number|null;}
export interface AssignmentDependencies{allowedOrigin?:string;getUserId(authorization:string):Promise<string|null>;canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;save(input:AssignmentInput):Promise<unknown>;}
export const refusalReasons={
 'Active worker required':'worker_inactive','Open job and exact interval required':'job_unavailable','Required skills missing':'missing_skills','Recorded working availability required':'outside_working_availability','Worker unavailable':'worker_unavailable','Worker already assigned':'overlap','Job staffing capacity full':'capacity_full','Worker changed':'stale_worker','Job changed':'stale_job','Working pattern changed':'stale_pattern','Assignment unavailable or changed':'stale_assignment',
} as const;
export type AssignmentRefusalCode=typeof refusalReasons[keyof typeof refusalReasons];
export class AssignmentRefusal extends Error{readonly code:AssignmentRefusalCode;constructor(code:AssignmentRefusalCode){super('Assignment refused');this.code=code;}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
const revision=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1&&v<Number.MAX_SAFE_INTEGER;
function instant(v:unknown):string|null{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v))return null;const ms=Date.parse(v);return Number.isFinite(ms)?new Date(ms).toISOString():null;}
export async function handleSchedulingAssignmentSave(request:Request,deps:AssignmentDependencies):Promise<Response>{
 if(!deps.allowedOrigin||request.headers.get('Origin')!==deps.allowedOrigin)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':deps.allowedOrigin,Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
 const authorization=request.headers.get('Authorization')??'';
 if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:'Authentication required.'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'JSON required.'});
 try{
  const raw=await request.text();if(raw.length>4096)return reply(400,{error:'Invalid assignment request.'});let body;
  try{body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid assignment request.'});}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='assignmentId,expectedJobVersion,expectedPatternVersion,expectedVersion,expectedWorkerVersion,jobId,requestId,status,workerId,workspaceId'
   ||!id(body.workspaceId)||!id(body.workerId)||!id(body.jobId)||!id(body.requestId)||(body.assignmentId!==null&&!id(body.assignmentId))
   ||(body.assignmentId===null?(body.status!=='active'||body.expectedVersion!==0||!revision(body.expectedWorkerVersion)||!revision(body.expectedJobVersion)||!revision(body.expectedPatternVersion)):(body.status!=='cancelled'||!revision(body.expectedVersion)||body.expectedWorkerVersion!==null||body.expectedJobVersion!==null||body.expectedPatternVersion!==null)))return reply(400,{error:'Invalid assignment request.'});
  const userId=await deps.getUserId(authorization);if(!id(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Assignment could not be saved.'});
  let value:unknown;
  try{value=await deps.save({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_request_id:body.requestId,target_assignment_id:body.assignmentId,target_worker_id:body.workerId,target_job_id:body.jobId,target_status:body.status,expected_version:body.expectedVersion,expected_worker_version:body.expectedWorkerVersion,expected_job_version:body.expectedJobVersion,expected_pattern_version:body.expectedPatternVersion});}
  catch(error){if(error instanceof AssignmentRefusal&&Object.values(refusalReasons).includes(error.code))return reply(409,{status:'refused',code:error.code,requestId:body.requestId});throw error;}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid result');const row=value as Record<string,unknown>;
  const startAt=instant(row.start_at),endAt=instant(row.end_at);
  if(!id(row.assignment_id)||(body.assignmentId!==null&&row.assignment_id!==body.assignmentId)||row.workspace_id!==body.workspaceId||row.worker_id!==body.workerId||row.job_id!==body.jobId||row.status!==body.status||row.version!==body.expectedVersion+1||!startAt||!endAt||Date.parse(startAt)>=Date.parse(endAt))throw Error('Invalid result');
  return reply(200,{assignmentId:row.assignment_id,workspaceId:row.workspace_id,workerId:row.worker_id,jobId:row.job_id,startAt,endAt,status:row.status,version:row.version});
 }catch{return reply(503,{error:'Assignment outcome could not be confirmed.',code:'outcome_unknown'});}
}
