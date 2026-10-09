import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleMeetingOutcomeSave } from './meetingOutcomeBoundary.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const caller = (authorization: string) => createClient(url, anonKey, {
  global: { headers: { Authorization: authorization } },
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((request) => handleMeetingOutcomeSave(request, {
  allowedOrigin: Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
  now: () => Date.now(),
  getUserId: async (authorization) => {
    const { data, error } = await caller(authorization).auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
  canManage: async (authorization, workspaceId, userId) => {
    const { data, error } = await caller(authorization)
      .from('workspace_members')
      .select('role,status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    return !error && data?.status === 'active' && ['owner', 'admin'].includes(data.role);
  },
  save: async (input) => {
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await service.rpc('save_rev_meeting_outcome', input);
    if (error || !data) throw new Error('Meeting outcome unavailable');
    return data;
  },
}));
