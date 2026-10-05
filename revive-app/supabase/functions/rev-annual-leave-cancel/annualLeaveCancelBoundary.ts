import {resolveAnnualLeaveOrigin} from '../_shared/annualLeaveOrigins.ts';

export interface ExpectedAnnualLeaveAccount {
 accountId:string;
 version:number;
}
export interface AnnualLeaveCancelInput {
 target_workspace_id:string;
 initiating_user_id:string;
 target_request_id:string;
 target_absence_id:string;
 expected_version:number;
 expected_accounts:{account_id:string;version:number}[];
}
export interface AnnualLeaveCancelDependencies {
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 cancel(input:AnnualLeaveCancelInput):Promise<unknown>;
}
export const annualLeaveCancelRefusalReasons={
 'Annual leave changed':'stale_absence',
 'Annual leave already cancelled':'already_cancelled',
 'Annual leave account changed':'stale_account',
 'Annual leave cancellation request unavailable':'request_conflict',
} as const;
export type AnnualLeaveCancelRefusalCode=typeof annualLeaveCancelRefusalReasons[keyof typeof annualLeaveCancelRefusalReasons];
export class AnnualLeaveCancelRefusal extends Error {
 readonly code:AnnualLeaveCancelRefusalCode;
 constructor(code:AnnualLeaveCancelRefusalCode){super('Annual leave cancellation refused');this.code=code;}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
const revision=(value:unknown)=>Number.isSafeInteger(value)&&(value as number)>=1&&(value as number)<Number.MAX_SAFE_INTEGER;
function accounts(value:unknown):value is ExpectedAnnualLeaveAccount[] {
 return Array.isArray(value)&&value.length>=1&&value.length<=4&&value.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).sort().join(',')==='accountId,version'&&id(item.accountId)&&revision(item.version))&&new Set(value.map(item=>item.accountId)).size===value.length;
}
function resultAccounts(value:unknown,expected:ExpectedAnnualLeaveAccount[]){
 if(!Array.isArray(value)||value.length!==expected.length)return false;
 const expectedById=new Map(expected.map(account=>[account.accountId,account.version]));
 const seen=new Set<string>();
 for(const item of value){
  if(!item||typeof item!=='object'||Array.isArray(item)||!id(item.account_id)||seen.has(item.account_id)||!expectedById.has(item.account_id)||item.version!==expectedById.get(item.account_id)!+1||!Number.isSafeInteger(item.remaining_minutes)||item.remaining_minutes<0)return false;
  seen.add(item.account_id);
 }
 return seen.size===expectedById.size;
}
export async function handleAnnualLeaveCancel(request:Request,deps:AnnualLeaveCancelDependencies):Promise<Response>{
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
  if(raw.length>4096)return reply(400,{error:'Invalid annual leave cancellation.'});
  const body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='absenceId,expectedAccounts,expectedVersion,requestId,workspaceId'||!id(body.workspaceId)||!id(body.absenceId)||!id(body.requestId)||!revision(body.expectedVersion)||!accounts(body.expectedAccounts))return reply(400,{error:'Invalid annual leave cancellation.'});
  const userId=await deps.getUserId(authorization);
  if(!id(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Annual leave could not be cancelled.'});
  const expectedAccounts=[...body.expectedAccounts].sort((a:ExpectedAnnualLeaveAccount,b:ExpectedAnnualLeaveAccount)=>a.accountId.localeCompare(b.accountId));
  let value:unknown;
  try{
   value=await deps.cancel({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_request_id:body.requestId,target_absence_id:body.absenceId,expected_version:body.expectedVersion,expected_accounts:expectedAccounts.map(account=>({account_id:account.accountId,version:account.version}))});
  }catch(error){
   if(error instanceof AnnualLeaveCancelRefusal&&Object.values(annualLeaveCancelRefusalReasons).includes(error.code))return reply(409,{status:'refused',code:error.code,requestId:body.requestId});
   throw error;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid result');
  const row=value as Record<string,unknown>;
  if(row.absence_id!==body.absenceId||row.workspace_id!==body.workspaceId||!id(row.worker_id)||row.status!=='cancelled'||row.version!==body.expectedVersion+1||!Number.isSafeInteger(row.reversed_minutes)||(row.reversed_minutes as number)<0||!resultAccounts(row.accounts,expectedAccounts))throw Error('Invalid result');
  return reply(200,{absenceId:row.absence_id,workspaceId:row.workspace_id,workerId:row.worker_id,status:'cancelled',version:row.version,reversedMinutes:row.reversed_minutes,accounts:(row.accounts as Record<string,unknown>[]).map(account=>({accountId:account.account_id,version:account.version,remainingMinutes:account.remaining_minutes}))});
 }catch{
  return reply(503,{error:'Annual leave cancellation outcome could not be confirmed.',code:'outcome_unknown'});
 }
}
