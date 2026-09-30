import type { OAuthInvoke } from './calendarOAuthBrowser';
export const connectionColumns = 'id,connection_status,provider_account_reference,authorized_by_user_id';
export const calendarColumns = 'id,connection_id,display_name,timezone,is_selected,active';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface CalendarConnectionMetadata { id:string; status:string; account:string|null; authorizedBy:string|null; }
export interface CalendarMetadata {id:string;connectionId:string;displayName:string;timezone:string;selected:boolean;active:boolean;}
export type CalendarMetadataRead=(table:string,columns:string,workspaceId:string)=>Promise<unknown>;
function rows(value:unknown):Record<string,unknown>[] {if(!Array.isArray(value)||value.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new Error('Calendar metadata unavailable');return value;}
export async function loadCalendarConnectionMetadata(workspaceId:string,read:CalendarMetadataRead){
 if(!uuid.test(workspaceId))throw new Error('Workspace required');
 const [rawConnections,rawCalendars]=await Promise.all([read('workspace_calendar_connections',connectionColumns,workspaceId),read('workspace_calendars',calendarColumns,workspaceId)]);
 const connections:CalendarConnectionMetadata[]=rows(rawConnections).map(row=>{
  if(typeof row.id!=='string'||!uuid.test(row.id)||typeof row.connection_status!=='string'||!['disconnected','connected','expired','revoked','error'].includes(row.connection_status)||(row.provider_account_reference!==null&&typeof row.provider_account_reference!=='string')||(row.authorized_by_user_id!==null&&(typeof row.authorized_by_user_id!=='string'||!uuid.test(row.authorized_by_user_id))))throw new Error('Calendar metadata unavailable');
  return{id:row.id,status:row.connection_status,account:row.provider_account_reference as string|null,authorizedBy:row.authorized_by_user_id as string|null};
 });
 const ids=new Set(connections.map(c=>c.id));
 const calendars:CalendarMetadata[]=rows(rawCalendars).map(row=>{
  if(typeof row.id!=='string'||!uuid.test(row.id)||typeof row.connection_id!=='string'||!ids.has(row.connection_id)||typeof row.display_name!=='string'||!row.display_name.trim()||typeof row.timezone!=='string'||typeof row.is_selected!=='boolean'||typeof row.active!=='boolean')throw new Error('Calendar metadata unavailable');
  return{id:row.id,connectionId:row.connection_id,displayName:row.display_name,timezone:row.timezone,selected:row.is_selected,active:row.active};
 });
 return{connections,calendars};
}
export async function requestCalendarDiscovery(workspaceId:string,connectionId:string,timezone:string,invoke:OAuthInvoke):Promise<number>{
 if(!uuid.test(workspaceId)||!uuid.test(connectionId)||!timezone.trim())throw new Error('Calendar identifiers and timezone required');
 new Intl.DateTimeFormat('en-GB',{timeZone:timezone});
 const value=await invoke('rev-calendar-discover',{workspaceId,connectionId,timezone});
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Discovery unavailable');
 const result=value as Record<string,unknown>;
 if(Object.keys(result).sort().join(',')!=='calendarCount,connectionId,connectionStatus'||result.connectionId!==connectionId||result.connectionStatus!=='connected'||typeof result.calendarCount!=='number'||!Number.isSafeInteger(result.calendarCount)||result.calendarCount<1||result.calendarCount>1000)throw new Error('Discovery unavailable');
 return result.calendarCount;
}
export async function requestCalendarSelection(workspaceId:string,calendarId:string,expectedConnectionId:string,invoke:OAuthInvoke):Promise<void>{
 if(!uuid.test(workspaceId)||!uuid.test(calendarId)||!uuid.test(expectedConnectionId))throw new Error('Calendar identifiers required');
 const value=await invoke('rev-calendar-select',{workspaceId,calendarId});
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Calendar selection unavailable');
 const result=value as Record<string,unknown>;
 if(Object.keys(result).sort().join(',')!=='calendarId,connectionId,selected'||result.calendarId!==calendarId||result.connectionId!==expectedConnectionId||result.selected!==true)throw new Error('Calendar selection unavailable');
}

export async function requestCalendarDisconnect(workspaceId:string,connectionId:string,invoke:OAuthInvoke):Promise<void>{
 if(!uuid.test(workspaceId)||!uuid.test(connectionId))throw new Error('Calendar identifiers required');
 const value=await invoke('rev-calendar-disconnect',{workspaceId,connectionId});
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Calendar disconnect unavailable');
 const result=value as Record<string,unknown>;
 if(Object.keys(result).sort().join(',')!=='connectionId,connectionStatus'||result.connectionId!==connectionId||result.connectionStatus!=='revoked')throw new Error('Calendar disconnect unavailable');
}
