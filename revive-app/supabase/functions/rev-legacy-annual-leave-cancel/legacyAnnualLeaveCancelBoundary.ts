import {resolveAnnualLeaveOrigin} from '../_shared/annualLeaveOrigins.ts';

export interface LegacyAnnualLeaveCancelInput {
 target_workspace_id:string;
 initiating_user_id:string;
 target_request_id:string;
 target_worker_id:string;
 target_unavailability_id:string;
 expected_version:number;
}
export interface LegacyAnnualLeaveCancelDependencies {
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 cancel(input:LegacyAnnualLeaveCancelInput):Promise<unknown>;
}
export const legacyAnnualLeaveCancelRefusalReasons={
 'Legacy annual leave changed':'stale_legacy_leave',
 'Legacy annual leave already cancelled':'already_cancelled',
 'Annual leave accounting cancellation required':'accounted_leave',
 'Legacy annual leave cancellation request unavailable':'request_conflict',
} as const;
export type LegacyAnnualLeaveCancelRefusalCode=typeof legacyAnnualLeaveCancelRefusalReasons[keyof typeof legacyAnnualLeaveCancelRefusalReasons];
export class LegacyAnnualLeaveCancelRefusal extends Error {
 readonly code:LegacyAnnualLeaveCancelRefusalCode;
 constructor(code:LegacyAnnualLeaveCancelRefusalCode){super('Legacy annual leave cancellation refused');this.code=code;}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
function storedInstant(value:unknown):string|null {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const milliseconds=Date.parse(value);
 return Number.isFinite(milliseconds)?new Date(milliseconds).toISOString():null;
}
export async function handleLegacyAnnualLeaveCancel(request:Request,deps:LegacyAnnualLeaveCancelDependencies):Promise<Response>{
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
  const raw=await request.text();
  if(raw.length>2048)return reply(400,{error:'Invalid historical leave cancellation.'});
  const body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='expectedVersion,requestId,unavailabilityId,workerId,workspaceId'||!id(body.workspaceId)||!id(body.workerId)||!id(body.unavailabilityId)||!id(body.requestId)||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1||body.expectedVersion>=Number.MAX_SAFE_INTEGER)return reply(400,{error:'Invalid historical leave cancellation.'});
  const userId=await deps.getUserId(authorization);
  if(!id(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Historical leave could not be cancelled.'});
  let value:unknown;
  try{value=await deps.cancel({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_request_id:body.requestId,target_worker_id:body.workerId,target_unavailability_id:body.unavailabilityId,expected_version:body.expectedVersion});}
  catch(error){
   if(error instanceof LegacyAnnualLeaveCancelRefusal&&Object.values(legacyAnnualLeaveCancelRefusalReasons).includes(error.code))return reply(409,{status:'refused',code:error.code,requestId:body.requestId});
   throw error;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid result');
  const row=value as Record<string,unknown>;
  const startAt=storedInstant(row.start_at);
  const endAt=storedInstant(row.end_at);
  if(row.unavailability_id!==body.unavailabilityId||row.workspace_id!==body.workspaceId||row.worker_id!==body.workerId||!startAt||!endAt||Date.parse(startAt)>=Date.parse(endAt)||row.category!=='leave'||row.status!=='cancelled'||row.version!==body.expectedVersion+1)throw Error('Invalid result');
  return reply(200,{unavailabilityId:row.unavailability_id,workspaceId:row.workspace_id,workerId:row.worker_id,startAt,endAt,category:'leave',status:'cancelled',version:row.version});
 }catch{
  return reply(503,{error:'Historical leave cancellation outcome could not be confirmed.',code:'outcome_unknown'});
 }
}
