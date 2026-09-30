import type { OAuthInvoke } from './calendarOAuthBrowser';
export const businessHoursColumns='workspace_id,timezone,working_days,business_start_local,business_end_local,version';
export interface BusinessHoursPolicy {workspaceId:string;timezone:string;workingDays:number[];startLocal:string;endLocal:string;version:number;}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validate(policy:BusinessHoursPolicy,minimumVersion:number){
 if(!uuid.test(policy.workspaceId)||typeof policy.timezone!=='string'||!policy.timezone.trim()||policy.timezone.trim()!==policy.timezone||policy.timezone.length>100||!Array.isArray(policy.workingDays)||policy.workingDays.length<1||policy.workingDays.length>7||policy.workingDays.some(d=>!Number.isInteger(d)||d<1||d>7)||new Set(policy.workingDays).size!==policy.workingDays.length||typeof policy.startLocal!=='string'||typeof policy.endLocal!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(policy.startLocal)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(policy.endLocal)||policy.startLocal>=policy.endLocal||!Number.isSafeInteger(policy.version)||policy.version<minimumVersion||policy.version>=Number.MAX_SAFE_INTEGER)throw new Error('Valid business hours required');
 new Intl.DateTimeFormat('en-GB',{timeZone:policy.timezone});
}
export async function loadBusinessHours(workspaceId:string,read:(columns:string,workspaceId:string)=>Promise<unknown>):Promise<BusinessHoursPolicy|null>{
 if(!uuid.test(workspaceId))throw new Error('Workspace required');
 const raw=await read(businessHoursColumns,workspaceId);
 if(!Array.isArray(raw)||raw.length>1)throw new Error('Business hours unavailable');
 if(raw.length===0)return null;
 const row=raw[0];if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!==businessHoursColumns.split(',').sort().join(','))throw new Error('Business hours unavailable');
 const policy={workspaceId:row.workspace_id,timezone:row.timezone,workingDays:row.working_days,startLocal:row.business_start_local,endLocal:row.business_end_local,version:row.version};
 validate(policy,1);if(policy.workspaceId!==workspaceId)throw new Error('Business hours unavailable');return policy;
}
export async function saveBusinessHours(policy:BusinessHoursPolicy,invoke:OAuthInvoke):Promise<BusinessHoursPolicy>{
 validate(policy,0);
 const workingDays=[...policy.workingDays].sort((a,b)=>a-b);
 const raw=await invoke('rev-calendar-business-hours-save',{workspaceId:policy.workspaceId,timezone:policy.timezone,workingDays,startLocal:policy.startLocal,endLocal:policy.endLocal,expectedVersion:policy.version});
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='endLocal,startLocal,timezone,version,workingDays,workspaceId')throw new Error('Save could not be confirmed');
 const result=raw as BusinessHoursPolicy;validate(result,1);
 if(result.workspaceId!==policy.workspaceId||result.timezone!==policy.timezone||result.startLocal!==policy.startLocal||result.endLocal!==policy.endLocal||result.version!==policy.version+1||JSON.stringify(result.workingDays)!==JSON.stringify(workingDays))throw new Error('Save could not be confirmed');return result;
}
