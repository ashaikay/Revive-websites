import { validateOAuthTokenConfiguration, type OAuthTokenConfiguration } from '../rev-calendar-oauth-complete/calendarOAuthCompletion.ts';
import { type OutlookCalendarDiscovery } from '../_shared/microsoftGraphCalendarDiscovery.ts';
export type CalendarDiscoveryStage='configuration'|'manager_check'|'credential_load'|'token_refresh'|'credential_rotation'|'calendar_discovery'|'database_save';
export type CalendarDiscoveryErrorCode='configuration_unavailable'|'manager_denied'|'manager_check_failed'|'credential_load_failed'|'token_refresh_failed'|'credential_rotation_failed'|'calendar_discovery_failed'|'database_save_failed';
export type CalendarDiscoveryDiagnostic=(stage:CalendarDiscoveryStage,code:CalendarDiscoveryErrorCode)=>void;
export class CalendarDiscoveryFailure extends Error{
 readonly stage:CalendarDiscoveryStage;
 readonly code:CalendarDiscoveryErrorCode;
 constructor(stage:CalendarDiscoveryStage,code:CalendarDiscoveryErrorCode){super(code);this.stage=stage;this.code=code;}
}
function failure(stage:CalendarDiscoveryStage,code:CalendarDiscoveryErrorCode):CalendarDiscoveryFailure{return new CalendarDiscoveryFailure(stage,code);}
export async function refreshCalendarDiscoveryToken(config:OAuthTokenConfiguration,refreshToken:string,fetchImpl:typeof fetch=fetch):Promise<{accessToken:string;refreshToken:string}>{
  validateOAuthTokenConfiguration(config);
  if(!refreshToken?.trim()||refreshToken.length>32768)throw new Error('Calendar authentication unavailable');
  try{
    const response=await fetchImpl(`https://login.microsoftonline.com/${config.authority}/oauth2/v2.0/token`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'refresh_token',refresh_token:refreshToken,scope:'offline_access https://graph.microsoft.com/Calendars.Read'})});
    if(!response.ok)throw new Error('Denied');const data=await response.json();
    const scopes=typeof data.scope==='string'?data.scope.toLowerCase().split(/\s+/):[];
    if(typeof data.access_token!=='string'||!data.access_token.trim()||/[\r\n]/.test(data.access_token)||data.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=0||!scopes.some((s:string)=>['calendars.read','https://graph.microsoft.com/calendars.read'].includes(s)))throw new Error('Invalid token');
    const rotated=data.refresh_token===undefined?refreshToken:data.refresh_token;
    if(typeof rotated!=='string'||!rotated.trim()||rotated.length>32768)throw new Error('Invalid refresh');return{accessToken:data.access_token,refreshToken:rotated};
  }catch{throw new Error('Calendar authentication unavailable');}
}
export interface DiscoveryWorkflowDependencies {
  load():Promise<{refresh_token:string;credential_reference:string;revision:number}>;
  refresh(refreshToken:string):Promise<{accessToken:string;refreshToken:string}>;
  rotate(refreshToken:string,revision:number):Promise<{credential_reference:string;revision:number}>;
  discover(accessToken:string):Promise<OutlookCalendarDiscovery>;
  save(result:OutlookCalendarDiscovery,reference:string,revision:number):Promise<{connection_id:string;connection_status:string;calendar_count:number}>;
}
export async function runCalendarDiscovery(connectionId:string,deps:DiscoveryWorkflowDependencies){
  let pending:Awaited<ReturnType<DiscoveryWorkflowDependencies['load']>>;
  try{
    pending=await deps.load();
    if(!pending||!Number.isSafeInteger(pending.revision)||pending.revision<1||typeof pending.credential_reference!=='string'||!pending.credential_reference)throw new Error();
  }catch{throw failure('credential_load','credential_load_failed');}
  let token:Awaited<ReturnType<DiscoveryWorkflowDependencies['refresh']>>;
  try{token=await deps.refresh(pending.refresh_token);}catch{throw failure('token_refresh','token_refresh_failed');}
  let rotated:Awaited<ReturnType<DiscoveryWorkflowDependencies['rotate']>>;
  try{
    rotated=await deps.rotate(token.refreshToken,pending.revision);
    if(rotated.credential_reference!==pending.credential_reference||rotated.revision!==pending.revision+1)throw new Error();
  }catch{throw failure('credential_rotation','credential_rotation_failed');}
  let result:OutlookCalendarDiscovery;
  try{result=await deps.discover(token.accessToken);}catch(error){if(error instanceof CalendarDiscoveryFailure)throw error;throw failure('calendar_discovery','calendar_discovery_failed');}
  let saved:Awaited<ReturnType<DiscoveryWorkflowDependencies['save']>>;
  try{
    saved=await deps.save(result,rotated.credential_reference,rotated.revision);
    if(saved.connection_id!==connectionId||saved.connection_status!=='connected'||!Number.isSafeInteger(saved.calendar_count)||saved.calendar_count<1||saved.calendar_count>1000||saved.calendar_count!==result.calendars.length)throw new Error();
  }catch{throw failure('database_save','database_save_failed');}
  return{connectionId,connectionStatus:'connected' as const,calendarCount:saved.calendar_count};
}
