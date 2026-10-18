import { supabaseClient } from '@/data/supabaseClient';
import { teamId } from './workspaceTeam';
export type SchedulingManagement = {workspaceId:string;userId:string;enabled:boolean;canManage:boolean;managed:boolean;version:number};
export type SchedulingPermissionAttempt = {workspaceId:string;userId:string;enabled:boolean;expectedVersion:number;requestId:string};
export class SchedulingPermissionRejected extends Error {}
export function parseSchedulingManagement(value:unknown,workspaceId:string,userId:string):SchedulingManagement {
 const row=value as SchedulingManagement|null;
 if(!row||row.workspaceId!==workspaceId||row.userId!==userId||typeof row.enabled!=='boolean'||typeof row.canManage!=='boolean'||typeof row.managed!=='boolean'||!Number.isSafeInteger(row.version)||row.version<0)throw Error('Scheduling permission could not be verified.');
 return row;
}
export function parseSchedulingPermissionAttempt(value:unknown,workspaceId:string):SchedulingPermissionAttempt {
 const row=value as SchedulingPermissionAttempt|null;
 if(!row||row.workspaceId!==workspaceId||!teamId.test(row.userId)||!teamId.test(row.requestId)||typeof row.enabled!=='boolean'||!Number.isSafeInteger(row.expectedVersion)||row.expectedVersion<0)throw Error('Retained Scheduling permission could not be verified.');
 return row;
}
export async function loadSchedulingManagement(workspaceId:string,userId:string) {
 if(!supabaseClient||!teamId.test(workspaceId)||!teamId.test(userId))throw Error('Scheduling permission is unavailable.');
 const {data,error}=await supabaseClient.rpc('get_rev_scheduling_management',{target_workspace_id:workspaceId,target_user_id:userId});
 if(error)throw Error('Scheduling permission is unavailable. Ask your organisation owner to check the update.');
 return parseSchedulingManagement(data,workspaceId,userId);
}
export async function saveSchedulingManagement(attempt:SchedulingPermissionAttempt) {
 parseSchedulingPermissionAttempt(attempt,attempt.workspaceId);
 if(!supabaseClient)throw Error('Save not confirmed.');
 const {data,error}=await supabaseClient.rpc('save_rev_scheduling_management',{target_workspace_id:attempt.workspaceId,target_user_id:attempt.userId,target_enabled:attempt.enabled,expected_version:attempt.expectedVersion,target_request_id:attempt.requestId});
 if(error){if(['42501','40001','22023','23503','23514'].includes(error.code))throw new SchedulingPermissionRejected(error.code==='40001'?'Permission changed. Reload before saving again.':'Permission not saved. Check that Scheduling section access is enabled for this active staff member.');throw Error('Save not confirmed.');}
 return parseSchedulingManagement(data,attempt.workspaceId,attempt.userId);
}
