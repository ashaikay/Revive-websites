export interface UnavailabilityInput {
 target_workspace_id:string;initiating_user_id:string;target_request_id:string;target_worker_id:string;target_unavailability_id:string|null;
 target_start_at:string;target_end_at:string;target_category:string;target_status:string;expected_version:number;
}
export interface UnavailabilityDependencies {
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 getWorkspaceTimezone(authorization:string,workspaceId:string):Promise<string|null>;
 save(input:UnavailabilityInput):Promise<unknown>;
}
export type WorkerUnavailabilityRefusalCode='assignment_conflict'|'stale_period'|'already_cancelled'|'inactive_worker';
export class WorkerUnavailabilityRefusal extends Error{readonly code:WorkerUnavailabilityRefusalCode;constructor(code:WorkerUnavailabilityRefusalCode){super(code);this.code=code;}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
function utc(v:unknown):v is string{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))return false;const ms=Date.parse(v);return Number.isFinite(ms)&&new Date(ms).toISOString()===v;}
function storedInstant(v:unknown):string|null{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v))return null;const ms=Date.parse(v);return Number.isFinite(ms)?new Date(ms).toISOString():null;}
function localValue(ms:number,timezone:string):string{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));const get=(type:string)=>parts.find(part=>part.type===type)?.value;return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;}
function isWorkspaceMidnight(value:string,timezone:string):boolean{try{return localValue(Date.parse(value),timezone).endsWith('T00:00');}catch{return false;}}
export async function handleWorkerUnavailabilitySave(request:Request,deps:UnavailabilityDependencies):Promise<Response>{
 if(!deps.allowedOrigin||request.headers.get('Origin')!==deps.allowedOrigin)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':deps.allowedOrigin,Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
 const authorization=request.headers.get('Authorization')??'';
 if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:'Authentication required.'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'JSON required.'});
 try{
  const raw=await request.text();if(raw.length>4096)return reply(400,{error:'Invalid unavailable period.'});const body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='category,endAt,expectedVersion,requestId,startAt,status,unavailabilityId,workerId,workspaceId'
   ||!id(body.workspaceId)||!id(body.workerId)||!id(body.requestId)||(body.unavailabilityId!==null&&!id(body.unavailabilityId))
   ||!utc(body.startAt)||!utc(body.endAt)||Date.parse(body.startAt)>=Date.parse(body.endAt)||!['unavailable','sickness'].includes(body.category)||!['active','cancelled'].includes(body.status)
   ||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||body.expectedVersion>=Number.MAX_SAFE_INTEGER
   ||(body.unavailabilityId===null?(body.expectedVersion!==0||body.status!=='active'):body.expectedVersion===0))return reply(400,{error:'Invalid unavailable period.'});
  const userId=await deps.getUserId(authorization);if(!id(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Unavailable period could not be saved.'});
  if(body.category==='sickness'&&body.status==='active'){const timezone=await deps.getWorkspaceTimezone(authorization,body.workspaceId);if(!timezone)return reply(403,{error:'Unavailable period could not be saved.'});if(!isWorkspaceMidnight(body.startAt,timezone)||!isWorkspaceMidnight(body.endAt,timezone))return reply(400,{error:'Invalid sickness dates.'});}
    let value:unknown;try{value=await deps.save({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_request_id:body.requestId,target_worker_id:body.workerId,target_unavailability_id:body.unavailabilityId,target_start_at:body.startAt,target_end_at:body.endAt,target_category:body.category,target_status:body.status,expected_version:body.expectedVersion});}catch(error){if(error instanceof WorkerUnavailabilityRefusal)return reply(409,{status:'refused',code:error.code,requestId:body.requestId});throw error;}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid result');const row=value as Record<string,unknown>;
  if(!id(row.unavailability_id)||(body.unavailabilityId!==null&&row.unavailability_id!==body.unavailabilityId)||row.workspace_id!==body.workspaceId||row.worker_id!==body.workerId||storedInstant(row.start_at)!==body.startAt||storedInstant(row.end_at)!==body.endAt||row.category!==body.category||row.status!==body.status||row.version!==body.expectedVersion+1)throw new Error('Invalid result');
  return reply(200,{unavailabilityId:row.unavailability_id,workspaceId:row.workspace_id,workerId:row.worker_id,startAt:body.startAt,endAt:body.endAt,category:row.category,status:row.status,version:row.version});
 }catch{return reply(403,{error:'Unavailable period could not be saved.'});}
}
