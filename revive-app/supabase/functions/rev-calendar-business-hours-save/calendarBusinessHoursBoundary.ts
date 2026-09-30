export interface BusinessHoursInput {
 target_workspace_id: string; initiating_user_id: string; target_timezone: string;
 target_working_days: number[]; target_start_local: string; target_end_local: string; expected_version: number;
}
export interface BusinessHoursDependencies {
 allowedOrigin?: string;
 getUserId(authorization: string): Promise<string | null>;
 canManage(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
 save(input: BusinessHoursInput): Promise<unknown>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const time=/^([01]\d|2[0-3]):[0-5]\d$/;
function validDays(value: unknown): value is number[] {
 return Array.isArray(value)&&value.length>=1&&value.length<=7&&value.every(d=>Number.isInteger(d)&&d>=1&&d<=7)&&new Set(value).size===value.length;
}
function validTimezone(value: unknown): value is string {
 if(typeof value!=='string'||!value||value.length>100||value.trim()!==value)return false;
 try{new Intl.DateTimeFormat('en-GB',{timeZone:value});return true;}catch{return false;}
}
export async function handleBusinessHoursSave(request: Request,deps: BusinessHoursDependencies): Promise<Response> {
 if(!deps.allowedOrigin||request.headers.get('Origin')!==deps.allowedOrigin)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':deps.allowedOrigin,Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
 const authorization=request.headers.get('Authorization')??'';
 if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:'Authentication required.'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'JSON required.'});
 try {
  const raw=await request.text();if(raw.length>2048)return reply(400,{error:'Invalid business hours.'});
  const body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='endLocal,expectedVersion,startLocal,timezone,workingDays,workspaceId'
   ||typeof body.workspaceId!=='string'||!uuid.test(body.workspaceId)||!validTimezone(body.timezone)||!validDays(body.workingDays)
   ||typeof body.startLocal!=='string'||typeof body.endLocal!=='string'||!time.test(body.startLocal)||!time.test(body.endLocal)||body.startLocal>=body.endLocal
   ||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||body.expectedVersion>=Number.MAX_SAFE_INTEGER)return reply(400,{error:'Invalid business hours.'});
  const userId=await deps.getUserId(authorization);
  if(!userId||!uuid.test(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId,userId))return reply(403,{error:'Business hours could not be saved.'});
  const days=[...body.workingDays].sort((a:number,b:number)=>a-b);
  const value=await deps.save({target_workspace_id:body.workspaceId,initiating_user_id:userId,target_timezone:body.timezone,target_working_days:days,target_start_local:body.startLocal,target_end_local:body.endLocal,expected_version:body.expectedVersion});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid result');
  const row=value as Record<string,unknown>;
  if(row.workspace_id!==body.workspaceId||row.timezone!==body.timezone||!validDays(row.working_days)||JSON.stringify(row.working_days)!==JSON.stringify(days)
   ||row.business_start_local!==body.startLocal||row.business_end_local!==body.endLocal||row.version!==body.expectedVersion+1)throw new Error('Invalid result');
  return reply(200,{workspaceId:row.workspace_id,timezone:row.timezone,workingDays:row.working_days,startLocal:row.business_start_local,endLocal:row.business_end_local,version:row.version});
 }catch{return reply(403,{error:'Business hours could not be saved.'});}
}
