export interface WorkerSaveInput {
 target_workspace_id:string;initiating_user_id:string;target_request_id:string;target_worker_id:string|null;
 target_display_name:string;target_role_labels:string[];target_skill_tags:string[];target_active:boolean;expected_version:number;
}
export interface WorkerSaveDependencies {
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 save(input:WorkerSaveInput):Promise<unknown>;
}
export type WorkerSaveRefusalCode='active_assignments'|'stale_worker';
export class WorkerSaveRefusal extends Error{readonly code:WorkerSaveRefusalCode;constructor(code:WorkerSaveRefusalCode){super(code);this.code=code;}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
function tags(value:unknown):value is string[]{return Array.isArray(value)&&value.length<=30&&value.every(t=>typeof t==='string'&&t.length>=1&&t.length<=80&&t.trim()===t)&&new Set(value).size===value.length;}
export async function handleWorkerSave(request:Request,deps:WorkerSaveDependencies):Promise<Response>{
 if(!deps.allowedOrigin||request.headers.get('Origin')!==deps.allowedOrigin)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':deps.allowedOrigin,Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
 const authorization=request.headers.get('Authorization')??'';
 if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:'Authentication required.'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'JSON required.'});
 try{
  const raw=await request.text();if(raw.length>16000)return reply(400,{error:'Invalid worker details.'});
  const body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='active,displayName,expectedVersion,requestId,roleLabels,skillTags,workerId,workspaceId'
   ||!validId(body.workspaceId)||!validId(body.requestId)||(body.workerId!==null&&!validId(body.workerId))
   ||typeof body.displayName!=='string'||body.displayName.length<1||body.displayName.length>120||body.displayName.trim()!==body.displayName
   ||!tags(body.roleLabels)||!tags(body.skillTags)||typeof body.active!=='boolean'||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||body.expectedVersion>=Number.MAX_SAFE_INTEGER
   ||(body.workerId===null?body.expectedVersion!==0:body.expectedVersion===0))return reply(400,{error:'Invalid worker details.'});
  const userId=await deps.getUserId(authorization);if(!validId(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Worker could not be saved.'});
  const roleLabels=[...body.roleLabels].sort(),skillTags=[...body.skillTags].sort();
    let value:unknown;try{value=await deps.save({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_request_id:body.requestId,target_worker_id:body.workerId,target_display_name:body.displayName,target_role_labels:roleLabels,target_skill_tags:skillTags,target_active:body.active,expected_version:body.expectedVersion});}catch(error){if(error instanceof WorkerSaveRefusal)return reply(409,{status:'refused',code:error.code,requestId:body.requestId});throw error;}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid result');
  const row=value as Record<string,unknown>;
  if(!validId(row.worker_id)||(body.workerId!==null&&row.worker_id!==body.workerId)||row.workspace_id!==body.workspaceId||row.display_name!==body.displayName||row.active!==body.active||row.version!==body.expectedVersion+1
   ||!tags(row.role_labels)||!tags(row.skill_tags)||JSON.stringify([...row.role_labels].sort())!==JSON.stringify(roleLabels)||JSON.stringify([...row.skill_tags].sort())!==JSON.stringify(skillTags))throw new Error('Invalid result');
  return reply(200,{workerId:row.worker_id,workspaceId:row.workspace_id,displayName:row.display_name,roleLabels,skillTags,active:row.active,version:row.version});
 }catch{return reply(403,{error:'Worker could not be saved.'});}
}
