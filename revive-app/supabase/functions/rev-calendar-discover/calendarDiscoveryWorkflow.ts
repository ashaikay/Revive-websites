import { validateOAuthTokenConfiguration, type OAuthTokenConfiguration } from '../rev-calendar-oauth-complete/calendarOAuthCompletion.ts';
import { type OutlookCalendarDiscovery } from '../_shared/microsoftGraphCalendarDiscovery.ts';
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
  const pending=await deps.load();if(!Number.isSafeInteger(pending.revision)||pending.revision<1||typeof pending.credential_reference!=='string')throw new Error('Credential unavailable');
  const token=await deps.refresh(pending.refresh_token);
  const rotated=await deps.rotate(token.refreshToken,pending.revision);
  if(rotated.credential_reference!==pending.credential_reference||rotated.revision!==pending.revision+1)throw new Error('Credential conflict');
  const result=await deps.discover(token.accessToken);
  const saved=await deps.save(result,rotated.credential_reference,rotated.revision);
  if(saved.connection_id!==connectionId||saved.connection_status!=='connected'||saved.calendar_count!==result.calendars.length)throw new Error('Discovery save unavailable');
  return{connectionId,connectionStatus:'connected' as const,calendarCount:saved.calendar_count};
}
