import type {OAuthInvoke} from './calendarOAuthBrowser';
export const workerColumns='id,workspace_id,display_name,role_labels,skill_tags,active,version';
export interface Worker {workerId:string;workspaceId:string;displayName:string;roleLabels:string[];skillTags:string[];active:boolean;version:number;}
export interface WorkerSaveAttempt {workspaceId:string;requestId:string;workerId:string|null;displayName:string;roleLabels:string[];skillTags:string[];active:boolean;expectedVersion:number;}
interface Storage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void;}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
function tags(v:unknown):v is string[]{return Array.isArray(v)&&v.length<=30&&v.every(t=>typeof t==='string'&&t.length>=1&&t.length<=80&&t.trim()===t)&&new Set(v).size===v.length;}
function fields(v:Record<string,unknown>){if(!validId(v.workspaceId)||typeof v.displayName!=='string'||v.displayName.length<1||v.displayName.length>120||v.displayName.trim()!==v.displayName||!tags(v.roleLabels)||!tags(v.skillTags)||typeof v.active!=='boolean')throw new Error('Valid worker details required');}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Worker data unavailable');return v as Record<string,unknown>;}
export function validateWorkerAttempt(value:unknown):WorkerSaveAttempt{
 const v=object(value);fields(v);
 if(Object.keys(v).sort().join(',')!=='active,displayName,expectedVersion,requestId,roleLabels,skillTags,workerId,workspaceId'||!validId(v.requestId)||(v.workerId!==null&&!validId(v.workerId))||!Number.isSafeInteger(v.expectedVersion)||(v.expectedVersion as number)<0||(v.expectedVersion as number)>=Number.MAX_SAFE_INTEGER||(v.workerId===null?v.expectedVersion!==0:v.expectedVersion===0))throw new Error('Valid worker request required');
 return {...v,roleLabels:[...(v.roleLabels as string[])].sort(),skillTags:[...(v.skillTags as string[])].sort()} as unknown as WorkerSaveAttempt;
}
export async function loadSchedulingWorkers(workspaceId:string,read:(columns:string,workspaceId:string)=>Promise<unknown>):Promise<Worker[]>{
 if(!validId(workspaceId))throw new Error('Workspace required');const raw=await read(workerColumns,workspaceId);if(!Array.isArray(raw))throw new Error('Worker list unavailable');
 const seen=new Set<string>();return raw.map(value=>{const row=object(value);if(Object.keys(row).sort().join(',')!==workerColumns.split(',').sort().join(','))throw new Error('Worker list unavailable');const worker={workerId:row.id,workspaceId:row.workspace_id,displayName:row.display_name,roleLabels:row.role_labels,skillTags:row.skill_tags,active:row.active,version:row.version};fields(worker);if(!validId(worker.workerId)||worker.workspaceId!==workspaceId||seen.has(worker.workerId)||!Number.isSafeInteger(worker.version)||(worker.version as number)<1)throw new Error('Worker list unavailable');seen.add(worker.workerId);return worker as Worker;});
}
export async function submitWorkerAttempt(attempt:WorkerSaveAttempt,invoke:OAuthInvoke):Promise<Worker>{
 const input=validateWorkerAttempt(attempt);const v=object(await invoke('rev-worker-save',{...input}));fields(v);
 if(Object.keys(v).sort().join(',')!=='active,displayName,roleLabels,skillTags,version,workerId,workspaceId'||!validId(v.workerId)||(input.workerId!==null&&v.workerId!==input.workerId)||v.workspaceId!==input.workspaceId||v.displayName!==input.displayName||v.active!==input.active||v.version!==input.expectedVersion+1||JSON.stringify([...(v.roleLabels as string[])].sort())!==JSON.stringify(input.roleLabels)||JSON.stringify([...(v.skillTags as string[])].sort())!==JSON.stringify(input.skillTags))throw new Error('Worker save could not be confirmed');return v as unknown as Worker;
}
function pendingKey(workspaceId:string,userId:string){if(!validId(workspaceId)||!validId(userId))throw new Error('Workspace and user required');return `rev-worker-save:${workspaceId}:${userId}`;}
export function rememberWorkerAttempt(storage:Storage,userId:string,attempt:WorkerSaveAttempt){const valid=validateWorkerAttempt(attempt);storage.setItem(pendingKey(valid.workspaceId,userId),JSON.stringify(valid));}
export function restoreWorkerAttempt(storage:Storage,workspaceId:string,userId:string):WorkerSaveAttempt|null{const raw=storage.getItem(pendingKey(workspaceId,userId));if(raw===null)return null;const valid=validateWorkerAttempt(JSON.parse(raw));if(valid.workspaceId!==workspaceId)throw new Error('Pending worker request unavailable');return valid;}
export function clearWorkerAttempt(storage:Storage,workspaceId:string,userId:string){storage.removeItem(pendingKey(workspaceId,userId));}
