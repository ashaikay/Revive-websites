import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCalendarDiscovery } from './calendarDiscoveryBoundary.ts';
import { runCalendarDiscovery, refreshCalendarDiscoveryToken, CalendarDiscoveryFailure, calendarDatabaseSaveErrorCode } from './calendarDiscoveryWorkflow.ts';
import { discoverMicrosoftGraphCalendars } from '../_shared/microsoftGraphCalendarDiscovery.ts';
import { validateOAuthTokenConfiguration } from '../rev-calendar-oauth-complete/calendarOAuthCompletion.ts';
const url=Deno.env.get('SUPABASE_URL')!;
const anonKey=Deno.env.get('SUPABASE_ANON_KEY')??Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const caller=(authorization:string)=>createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(request=>handleCalendarDiscovery(request,{
 allowedOrigin:Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
 reportFailure:(stage,code)=>console.error('rev-calendar-discover',JSON.stringify({stage,code})),
 getUserId:async authorization=>{const{data,error}=await caller(authorization).auth.getUser();return error?null:data.user?.id??null;},
 canManage:async(authorization,workspaceId,userId)=>{const{data,error}=await caller(authorization).from('workspace_members').select('role,status').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();return !error&&data?.status==='active'&&['owner','admin'].includes(data.role);},
 discover:async(workspaceId,connectionId,userId,timezone)=>{
  const configuration={clientId:Deno.env.get('REV_CALENDAR_OAUTH_CLIENT_ID')??'',clientSecret:Deno.env.get('REV_CALENDAR_OAUTH_CLIENT_SECRET')??'',authority:Deno.env.get('REV_CALENDAR_OAUTH_AUTHORITY')??'',redirectUri:Deno.env.get('REV_CALENDAR_OAUTH_REDIRECT_URI')??''};
  try{validateOAuthTokenConfiguration(configuration);}catch{throw new CalendarDiscoveryFailure('configuration','configuration_unavailable');}
  const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const rpc=async(name:string,args:Record<string,unknown>)=>{const{data,error}=await service.rpc(name,args);if(error){if(name==='save_rev_calendar_discovery'){const state=error&&typeof error==='object'&&'code'in error?error.code:undefined;const message=error&&typeof error==='object'&&'message'in error?error.message:undefined;throw new CalendarDiscoveryFailure('database_save',calendarDatabaseSaveErrorCode(state,message));}throw new Error('Discovery storage unavailable');}const row=Array.isArray(data)?data[0]:data;if(!row)throw new Error('Discovery storage unavailable');return row;};
  const bound={target_workspace_id:workspaceId,target_connection_id:connectionId,initiating_user_id:userId};
  return runCalendarDiscovery(connectionId,{
   load:()=>rpc('load_rev_pending_calendar_credential',bound),
   refresh:token=>refreshCalendarDiscoveryToken(configuration,token),
   rotate:(token,revision)=>rpc('rotate_rev_pending_calendar_credential',{...bound,refresh_token:token,expected_revision:revision}),
   discover:discoverMicrosoftGraphCalendars,
   save:(result,reference,revision)=>rpc('save_rev_calendar_discovery',{...bound,target_credential_reference:reference,expected_revision:revision,target_account_reference:result.providerAccountReference,target_timezone:timezone,discovered_calendars:result.calendars}),
  });
 },
}));
