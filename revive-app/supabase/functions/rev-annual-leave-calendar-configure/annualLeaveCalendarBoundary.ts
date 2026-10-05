import {resolveAnnualLeaveOrigin} from '../_shared/annualLeaveOrigins.ts';

export interface AnnualLeaveCalendarInput {
 target_workspace_id:string;
 initiating_user_id:string;
 target_request_id:string;
 target_action:'save_calendar'|'assign_worker'|'confirm_year';
 target_calendar_id:string|null;
 target_worker_id:string|null;
 target_name:string|null;
 target_region_code:string|null;
 target_status:'active'|'inactive'|null;
 target_calendar_year:number|null;
 expected_version:number;
}
export interface AnnualLeaveCalendarDependencies {
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 configure(input:AnnualLeaveCalendarInput):Promise<unknown>;
}
export const annualLeaveCalendarRefusalReasons={
 'Annual leave calendar changed':'stale_calendar',
 'Annual leave calendar already exists':'calendar_exists',
 'Worker annual leave calendar changed':'stale_assignment',
 'Annual leave calendar year changed':'stale_year',
 'Annual leave calendar unavailable':'missing_calendar',
 'Annual leave calendar request unavailable':'request_conflict',
} as const;
export type AnnualLeaveCalendarRefusalCode=typeof annualLeaveCalendarRefusalReasons[keyof typeof annualLeaveCalendarRefusalReasons];
export class AnnualLeaveCalendarRefusal extends Error {
 readonly code:AnnualLeaveCalendarRefusalCode;
 constructor(code:AnnualLeaveCalendarRefusalCode){super('Annual leave calendar configuration refused');this.code=code;}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
const revision=(value:unknown)=>Number.isSafeInteger(value)&&(value as number)>=0&&(value as number)<Number.MAX_SAFE_INTEGER;
const region=(value:unknown):value is string=>typeof value==='string'&&/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(value);
export async function handleAnnualLeaveCalendarConfigure(request:Request,deps:AnnualLeaveCalendarDependencies):Promise<Response>{
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
  if(raw.length>4096)return reply(400,{error:'Invalid annual leave calendar configuration.'});
  const body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body)||!id(body.workspaceId)||!id(body.requestId)||!revision(body.expectedVersion))return reply(400,{error:'Invalid annual leave calendar configuration.'});
  let input:Omit<AnnualLeaveCalendarInput,'initiating_user_id'>;
  if(body.action==='save_calendar'&&Object.keys(body).sort().join(',')==='action,calendarId,expectedVersion,name,regionCode,requestId,status,workspaceId'&&(body.calendarId===null||id(body.calendarId))&&typeof body.name==='string'&&body.name===body.name.trim()&&body.name.length>=1&&body.name.length<=120&&region(body.regionCode)&&['active','inactive'].includes(body.status)&&(body.calendarId===null?(body.expectedVersion===0&&body.status==='active'):body.expectedVersion>=1)){
   input={target_workspace_id:body.workspaceId,target_request_id:body.requestId,target_action:'save_calendar',target_calendar_id:body.calendarId,target_worker_id:null,target_name:body.name,target_region_code:body.regionCode,target_status:body.status,target_calendar_year:null,expected_version:body.expectedVersion};
  }else if(body.action==='assign_worker'&&Object.keys(body).sort().join(',')==='action,calendarId,expectedVersion,requestId,workerId,workspaceId'&&id(body.calendarId)&&id(body.workerId)){
   input={target_workspace_id:body.workspaceId,target_request_id:body.requestId,target_action:'assign_worker',target_calendar_id:body.calendarId,target_worker_id:body.workerId,target_name:null,target_region_code:null,target_status:null,target_calendar_year:null,expected_version:body.expectedVersion};
  }else if(body.action==='confirm_year'&&Object.keys(body).sort().join(',')==='action,calendarId,calendarYear,expectedVersion,requestId,workspaceId'&&id(body.calendarId)&&Number.isSafeInteger(body.calendarYear)&&body.calendarYear>=1000&&body.calendarYear<=9999){
   input={target_workspace_id:body.workspaceId,target_request_id:body.requestId,target_action:'confirm_year',target_calendar_id:body.calendarId,target_worker_id:null,target_name:null,target_region_code:null,target_status:null,target_calendar_year:body.calendarYear,expected_version:body.expectedVersion};
  }else return reply(400,{error:'Invalid annual leave calendar configuration.'});
  const userId=await deps.getUserId(authorization);
  if(!id(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Annual leave calendar could not be configured.'});
  let value:unknown;
  try{value=await deps.configure({...input,initiating_user_id:userId});}
  catch(error){
   if(error instanceof AnnualLeaveCalendarRefusal&&Object.values(annualLeaveCalendarRefusalReasons).includes(error.code))return reply(409,{status:'refused',code:error.code,requestId:body.requestId});
   throw error;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid result');
  const row=value as Record<string,unknown>;
  if(row.action!==body.action||row.workspace_id!==body.workspaceId||row.calendar_id!==body.calendarId&&body.calendarId!==null)throw Error('Invalid result');
  if(body.action==='save_calendar'){
   if(!id(row.calendar_id)||row.name!==body.name||row.region_code!==body.regionCode||row.status!==body.status||row.version!==body.expectedVersion+1)throw Error('Invalid result');
   return reply(200,{action:body.action,calendarId:row.calendar_id,workspaceId:row.workspace_id,name:row.name,regionCode:row.region_code,status:row.status,version:row.version});
  }
  if(body.action==='assign_worker'){
   if(row.worker_id!==body.workerId||row.version!==body.expectedVersion+1)throw Error('Invalid result');
   return reply(200,{action:body.action,workspaceId:row.workspace_id,workerId:row.worker_id,calendarId:row.calendar_id,version:row.version});
  }
  const expectedRevision=body.expectedVersion===0?1:body.expectedVersion;
  if(row.calendar_year!==body.calendarYear||row.revision!==expectedRevision||row.confirmed_revision!==expectedRevision)throw Error('Invalid result');
  return reply(200,{action:body.action,workspaceId:row.workspace_id,calendarId:row.calendar_id,calendarYear:row.calendar_year,revision:row.revision,confirmedRevision:row.confirmed_revision});
 }catch{
  return reply(503,{error:'Annual leave calendar outcome could not be confirmed.',code:'outcome_unknown'});
 }
}
