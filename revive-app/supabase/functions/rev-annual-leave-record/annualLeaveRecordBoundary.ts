import {resolveAnnualLeaveOrigin} from '../_shared/annualLeaveOrigins.ts';

export interface ExpectedAnnualLeaveAccount {
 accountId:string;
 version:number;
}
export interface AnnualLeaveRecordInput {
 target_workspace_id:string;
 initiating_user_id:string;
 target_request_id:string;
 target_worker_id:string;
 target_start_at:string;
 target_end_at:string;
 expected_accounts:{account_id:string;version:number}[];
}
export interface AnnualLeaveRecordDependencies {
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 record(input:AnnualLeaveRecordInput):Promise<unknown>;
}
export const annualLeaveRecordRefusalReasons={
 'Active worker required':'inactive_worker',
 'Working pattern unavailable':'missing_pattern',
 'Working pattern local time ambiguous':'ambiguous_pattern_time',
 'Annual leave calendar unavailable':'missing_calendar',
 'Annual leave calendar year unconfirmed':'calendar_year_unconfirmed',
 'Annual leave account unavailable':'missing_account',
 'Annual leave account changed':'stale_account',
 'Annual leave balance insufficient':'insufficient_balance',
 'Cancel affected assignments before recording annual leave':'assignment_conflict',
 'Annual leave overlaps existing leave':'overlap',
 'Annual leave record request unavailable':'request_conflict',
} as const;
export type AnnualLeaveRecordRefusalCode=typeof annualLeaveRecordRefusalReasons[keyof typeof annualLeaveRecordRefusalReasons];
export class AnnualLeaveRecordRefusal extends Error {
 readonly code:AnnualLeaveRecordRefusalCode;
 constructor(code:AnnualLeaveRecordRefusalCode){super('Annual leave recording refused');this.code=code;}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
const revision=(value:unknown)=>Number.isSafeInteger(value)&&(value as number)>=1&&(value as number)<Number.MAX_SAFE_INTEGER;
function utc(value:unknown):value is string {
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
}
function storedInstant(value:unknown):string|null {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const milliseconds=Date.parse(value);
 return Number.isFinite(milliseconds)?new Date(milliseconds).toISOString():null;
}
function accounts(value:unknown):value is ExpectedAnnualLeaveAccount[] {
 return Array.isArray(value)&&value.length>=1&&value.length<=4&&value.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).sort().join(',')==='accountId,version'&&id(item.accountId)&&revision(item.version))&&new Set(value.map(item=>item.accountId)).size===value.length;
}
function resultAccounts(value:unknown,expected:ExpectedAnnualLeaveAccount[],totalDeductionMinutes:number){
 if(!Array.isArray(value)||value.length!==expected.length)return false;
 const expectedById=new Map(expected.map(account=>[account.accountId,account.version]));
 const seen=new Set<string>();
 let deductionTotal=0;
 for(const item of value){
  if(!item||typeof item!=='object'||Array.isArray(item)||!id(item.account_id)||seen.has(item.account_id)||!expectedById.has(item.account_id)||item.version!==expectedById.get(item.account_id)!+1||!Number.isSafeInteger(item.deducted_minutes)||item.deducted_minutes<0||!Number.isSafeInteger(item.remaining_minutes)||item.remaining_minutes<0)return false;
  seen.add(item.account_id);
  deductionTotal+=item.deducted_minutes;
  if(!Number.isSafeInteger(deductionTotal))return false;
 }
 return seen.size===expectedById.size&&deductionTotal===totalDeductionMinutes;
}
export async function handleAnnualLeaveRecord(request:Request,deps:AnnualLeaveRecordDependencies):Promise<Response>{
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
  if(raw.length>4096)return reply(400,{error:'Invalid annual leave record.'});
  const body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='endAt,expectedAccounts,requestId,startAt,workerId,workspaceId'||!id(body.workspaceId)||!id(body.workerId)||!id(body.requestId)||!utc(body.startAt)||!utc(body.endAt)||Date.parse(body.startAt)>=Date.parse(body.endAt)||Date.parse(body.endAt)-Date.parse(body.startAt)>370*86400000||!accounts(body.expectedAccounts))return reply(400,{error:'Invalid annual leave record.'});
  const userId=await deps.getUserId(authorization);
  if(!id(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Annual leave could not be recorded.'});
  const expectedAccounts=[...body.expectedAccounts].sort((a:ExpectedAnnualLeaveAccount,b:ExpectedAnnualLeaveAccount)=>a.accountId.localeCompare(b.accountId));
  let value:unknown;
  try{
   value=await deps.record({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_request_id:body.requestId,target_worker_id:body.workerId,target_start_at:body.startAt,target_end_at:body.endAt,expected_accounts:expectedAccounts.map(account=>({account_id:account.accountId,version:account.version}))});
  }catch(error){
   if(error instanceof AnnualLeaveRecordRefusal&&Object.values(annualLeaveRecordRefusalReasons).includes(error.code))return reply(409,{status:'refused',code:error.code,requestId:body.requestId});
   throw error;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid result');
  const row=value as Record<string,unknown>;
  if(!id(row.absence_id)||!id(row.unavailability_id)||row.workspace_id!==body.workspaceId||row.worker_id!==body.workerId||storedInstant(row.start_at)!==body.startAt||storedInstant(row.end_at)!==body.endAt||typeof row.timezone!=='string'||row.timezone.length<1||row.timezone.length>100||row.status!=='confirmed'||row.version!==1||!Number.isSafeInteger(row.total_deduction_minutes)||(row.total_deduction_minutes as number)<0||!resultAccounts(row.accounts,expectedAccounts,row.total_deduction_minutes as number))throw Error('Invalid result');
  return reply(200,{absenceId:row.absence_id,unavailabilityId:row.unavailability_id,workspaceId:row.workspace_id,workerId:row.worker_id,startAt:body.startAt,endAt:body.endAt,timezone:row.timezone,status:'confirmed',version:1,totalDeductionMinutes:row.total_deduction_minutes,accounts:(row.accounts as Record<string,unknown>[]).map(account=>({accountId:account.account_id,version:account.version,deductedMinutes:account.deducted_minutes,remainingMinutes:account.remaining_minutes}))});
 }catch{
  return reply(503,{error:'Annual leave recording outcome could not be confirmed.',code:'outcome_unknown'});
 }
}
