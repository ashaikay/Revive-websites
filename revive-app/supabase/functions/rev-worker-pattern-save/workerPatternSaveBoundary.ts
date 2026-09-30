export interface WorkerPatternInput {
 target_workspace_id:string;initiating_user_id:string;target_request_id:string;target_worker_id:string;
 target_timezone:string;target_working_days:number[];target_start_local:string;target_end_local:string;
 target_effective_from:string;target_effective_until:string|null;expected_version:number;
}
export interface WorkerPatternDependencies {
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 save(input:WorkerPatternInput):Promise<unknown>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
const time=/^([01]\d|2[0-3]):[0-5]\d$/;
function date(v:unknown):v is string{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'1000-01-01')return false;const ms=Date.parse(v+'T00:00:00.000Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===v;}
function timezone(v:unknown):v is string{if(typeof v!=='string'||!v||v.trim()!==v||v.length>100)return false;try{new Intl.DateTimeFormat('en-GB',{timeZone:v});return true;}catch{return false;}}
function days(v:unknown):v is number[]{return Array.isArray(v)&&v.length>=1&&v.length<=7&&v.every(d=>Number.isInteger(d)&&d>=1&&d<=7)&&new Set(v).size===v.length;}
export async function handleWorkerPatternSave(request:Request,deps:WorkerPatternDependencies):Promise<Response>{
 if(!deps.allowedOrigin||request.headers.get('Origin')!==deps.allowedOrigin)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':deps.allowedOrigin,Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
 const authorization=request.headers.get('Authorization')??'';
 if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:'Authentication required.'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'JSON required.'});
 try{
  const raw=await request.text();if(raw.length>4096)return reply(400,{error:'Invalid working pattern.'});const body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='effectiveFrom,effectiveUntil,endLocal,expectedVersion,requestId,startLocal,timezone,workerId,workingDays,workspaceId'
   ||!validId(body.workspaceId)||!validId(body.workerId)||!validId(body.requestId)||!timezone(body.timezone)||!days(body.workingDays)
   ||typeof body.startLocal!=='string'||typeof body.endLocal!=='string'||!time.test(body.startLocal)||!time.test(body.endLocal)||body.startLocal>=body.endLocal
   ||!date(body.effectiveFrom)||(body.effectiveUntil!==null&&(!date(body.effectiveUntil)||body.effectiveUntil<body.effectiveFrom))
   ||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||body.expectedVersion>=Number.MAX_SAFE_INTEGER)return reply(400,{error:'Invalid working pattern.'});
  const userId=await deps.getUserId(authorization);if(!validId(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Working pattern could not be saved.'});
  const workingDays=[...body.workingDays].sort((a:number,b:number)=>a-b);
  const value=await deps.save({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_request_id:body.requestId,target_worker_id:body.workerId,target_timezone:body.timezone,target_working_days:workingDays,target_start_local:body.startLocal,target_end_local:body.endLocal,target_effective_from:body.effectiveFrom,target_effective_until:body.effectiveUntil,expected_version:body.expectedVersion});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid result');const row=value as Record<string,unknown>;
  if(!validId(row.pattern_id)||row.workspace_id!==body.workspaceId||row.worker_id!==body.workerId||row.timezone!==body.timezone||row.start_local!==body.startLocal||row.end_local!==body.endLocal||row.effective_from!==body.effectiveFrom||row.effective_until!==body.effectiveUntil||row.version!==body.expectedVersion+1||!days(row.working_days)||JSON.stringify([...row.working_days].sort((a,b)=>a-b))!==JSON.stringify(workingDays))throw new Error('Invalid result');
  return reply(200,{patternId:row.pattern_id,workspaceId:row.workspace_id,workerId:row.worker_id,timezone:row.timezone,workingDays,startLocal:row.start_local,endLocal:row.end_local,effectiveFrom:row.effective_from,effectiveUntil:row.effective_until,version:row.version});
 }catch{return reply(403,{error:'Working pattern could not be saved.'});}
}
