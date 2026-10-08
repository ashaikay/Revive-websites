import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCalendarOAuthCompletion, exchangeCalendarOAuthCode, validateOAuthTokenConfiguration } from './calendarOAuthCompletion.ts';
const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const caller = (authorization: string) => createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
const configuration = () => ({clientId:Deno.env.get('REV_CALENDAR_OAUTH_CLIENT_ID') ?? '',clientSecret:Deno.env.get('REV_CALENDAR_OAUTH_CLIENT_SECRET') ?? '',authority:Deno.env.get('REV_CALENDAR_OAUTH_AUTHORITY') ?? '',redirectUri:Deno.env.get('REV_CALENDAR_OAUTH_REDIRECT_URI') ?? ''});
const trustedRpc = async (name: string, input: Record<string,unknown>) => {
  const service = createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error} = await service.rpc(name,input); if (error) throw new Error('OAuth storage unavailable'); return data;
};
Deno.serve((request) => handleCalendarOAuthCompletion(request,{
  allowedOrigin:Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
  getUserId:async(authorization)=>{const {data,error}=await caller(authorization).auth.getUser();return error?null:data.user?.id??null;},
  canManage:async(authorization,workspaceId,userId)=>{const {data,error}=await caller(authorization).from('workspace_members').select('role,status').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();return !error&&data?.status==='active'&&['owner','admin'].includes(data.role);},
  validateConfiguration:()=>validateOAuthTokenConfiguration(configuration()),
  consume:async(input)=>{const data=await trustedRpc('consume_rev_calendar_oauth_with_consent',input);const row=Array.isArray(data)&&data.length===1?data[0]:null;if(!row||typeof row.pkce_verifier!=='string'||!['read','write'].includes(row.requested_access_mode)||!Number.isSafeInteger(row.expected_credential_revision))throw new Error('OAuth state unavailable');return{verifier:row.pkce_verifier,accessMode:row.requested_access_mode,expectedRevision:row.expected_credential_revision};},
  exchange:(code,verifier,accessMode)=>exchangeCalendarOAuthCode(configuration(),code,verifier,accessMode),
  store:async(input)=>{const data=await trustedRpc('store_rev_calendar_credential_with_consent',input);const row=Array.isArray(data)?data[0]:data;if(!row)throw new Error('Credential unavailable');return row;},
}));
