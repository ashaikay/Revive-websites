import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCalendarOAuthStart } from './calendarOAuthStartBoundary.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const caller = (authorization: string) => createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve((request) => handleCalendarOAuthStart(request, {
  allowedOrigin: Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
  clientId: Deno.env.get('REV_CALENDAR_OAUTH_CLIENT_ID'),
  authority: Deno.env.get('REV_CALENDAR_OAUTH_AUTHORITY'),
  redirectUri: Deno.env.get('REV_CALENDAR_OAUTH_REDIRECT_URI'),
  getUserId: async (authorization) => { const { data, error } = await caller(authorization).auth.getUser(); return error ? null : data.user?.id ?? null; },
  canManage: async (authorization, workspaceId, userId) => {
    const { data, error } = await caller(authorization).from('workspace_members').select('role,status').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
    return !error && data?.status === 'active' && ['owner', 'admin'].includes(data.role);
  },
  hasConnection: async (authorization, workspaceId, connectionId) => {
    const { data, error } = await caller(authorization).from('workspace_calendar_connections').select('id').eq('workspace_id', workspaceId).eq('id', connectionId).eq('provider_key', 'microsoft_graph').maybeSingle();
    return !error && data?.id === connectionId;
  },
  begin: async (input) => {
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.rpc('begin_rev_calendar_oauth', input);
    if (error || typeof data !== 'string') throw new Error('OAuth transaction unavailable');
    return data;
  },
}));
