import {resolveAnnualLeaveOrigin} from '../_shared/annualLeaveOrigins.ts';

export interface WorkspaceBankHolidayInput {
 target_workspace_id:string;
 initiating_user_id:string;
 target_request_id:string;
 target_calendar_id:string;
 target_holiday_id:string|null;
 target_holiday_date:string;
 target_name:string;
 target_status:'active'|'cancelled';
 expected_version:number;
}
export interface WorkspaceBankHolidayDependencies {
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 save(input:WorkspaceBankHolidayInput):Promise<unknown>;
}
export const bankHolidayRefusalReasons={
 'Bank holiday changed':'stale_holiday',
 'Bank holiday already exists':'date_conflict',
 'Bank holiday request unavailable':'request_conflict',
} as const;
export type BankHolidayRefusalCode=typeof bankHolidayRefusalReasons[keyof typeof bankHolidayRefusalReasons];
export class BankHolidayRefusal extends Error {
 readonly code:BankHolidayRefusalCode;
 constructor(code:BankHolidayRefusalCode){super('Bank holiday refused');this.code=code;}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
function date(value:unknown):value is string {
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
export async function handleWorkspaceBankHolidaySave(request:Request,deps:WorkspaceBankHolidayDependencies):Promise<Response>{
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
  if(raw.length>2048)return reply(400,{error:'Invalid bank holiday.'});
  const body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='calendarId,expectedVersion,holidayDate,holidayId,name,requestId,status,workspaceId'||!id(body.workspaceId)||!id(body.calendarId)||!id(body.requestId)||(body.holidayId!==null&&!id(body.holidayId))||!date(body.holidayDate)||typeof body.name!=='string'||body.name!==body.name.trim()||body.name.length<1||body.name.length>120||!['active','cancelled'].includes(body.status)||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||body.expectedVersion>=Number.MAX_SAFE_INTEGER||(body.holidayId===null?(body.expectedVersion!==0||body.status!=='active'):body.expectedVersion===0))return reply(400,{error:'Invalid bank holiday.'});
  const userId=await deps.getUserId(authorization);
  if(!id(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Bank holiday could not be saved.'});
  let value:unknown;
  try{
   value=await deps.save({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_request_id:body.requestId,target_calendar_id:body.calendarId,target_holiday_id:body.holidayId,target_holiday_date:body.holidayDate,target_name:body.name,target_status:body.status,expected_version:body.expectedVersion});
  }catch(error){
   if(error instanceof BankHolidayRefusal&&Object.values(bankHolidayRefusalReasons).includes(error.code))return reply(409,{status:'refused',code:error.code,requestId:body.requestId});
   throw error;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid result');
  const row=value as Record<string,unknown>;
  if(!id(row.holiday_id)||(body.holidayId!==null&&row.holiday_id!==body.holidayId)||row.workspace_id!==body.workspaceId||row.calendar_id!==body.calendarId||row.holiday_date!==body.holidayDate||row.name!==body.name||row.status!==body.status||row.version!==body.expectedVersion+1)throw Error('Invalid result');
  return reply(200,{holidayId:row.holiday_id,workspaceId:row.workspace_id,calendarId:row.calendar_id,holidayDate:row.holiday_date,name:row.name,status:row.status,version:row.version});
 }catch{
  return reply(503,{error:'Bank holiday outcome could not be confirmed.',code:'outcome_unknown'});
 }
}
