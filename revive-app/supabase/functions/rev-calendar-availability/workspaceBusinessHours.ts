export const workspaceBusinessHoursColumns='workspace_id,timezone,working_days,business_start_local,business_end_local,version';
export interface WorkspaceBusinessHours {workspaceId:string;timezone:string;workingDays:number[];startLocal:string;endLocal:string;version:number;}
export type BusinessHoursRead=(workspaceId:string,columns:string)=>Promise<unknown>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function load(workspaceId:string,timezone:string,read:BusinessHoursRead):Promise<WorkspaceBusinessHours>{
 const raw=await read(workspaceId,workspaceBusinessHoursColumns);
 if(!Array.isArray(raw)||raw.length!==1)throw new Error('Workspace business hours unavailable.');
 const row=raw[0];
 if(!row||typeof row!=='object'||Array.isArray(row)||row.workspace_id!==workspaceId||row.timezone!==timezone
  ||!Array.isArray(row.working_days)||row.working_days.length<1||row.working_days.length>7||row.working_days.some((day:unknown)=>typeof day!=='number'||!Number.isInteger(day)||day<1||day>7)||new Set(row.working_days).size!==row.working_days.length
  ||typeof row.business_start_local!=='string'||typeof row.business_end_local!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.business_start_local)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.business_end_local)||row.business_start_local>=row.business_end_local
  ||!Number.isSafeInteger(row.version)||row.version<1)throw new Error('Workspace business hours unavailable.');
 return {workspaceId,timezone,workingDays:[...row.working_days].sort((a:number,b:number)=>a-b),startLocal:row.business_start_local,endLocal:row.business_end_local,version:row.version};
}
/** Called only after the HTTP boundary verifies authentication, membership and the read gate. */
export async function withWorkspaceBusinessHours<T>(workspaceId:string,timezone:string,read:BusinessHoursRead,run:(policy:WorkspaceBusinessHours)=>Promise<T>):Promise<T>{
 if(!uuid.test(workspaceId)||typeof timezone!=='string'||!timezone.trim())throw new Error('Workspace business hours unavailable.');
 new Intl.DateTimeFormat('en-GB',{timeZone:timezone});
 const policy=await load(workspaceId,timezone,read);
 const result=await run(policy);
 const latest=await load(workspaceId,timezone,read);
 if(JSON.stringify(latest)!==JSON.stringify(policy))throw new Error('Workspace business hours changed.');
 return result;
}
