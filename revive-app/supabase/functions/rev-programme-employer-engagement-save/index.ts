import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleEmployerEngagementSave } from './employerEngagementBoundary.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const caller = (authorization: string) => createClient(url, anonKey, {
  global: { headers: { Authorization: authorization } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve((request) => handleEmployerEngagementSave(request, {
  allowedOrigin: Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
  getUserId: async (authorization) => {
    const { data, error } = await caller(authorization).auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
  canAccessProgramme: async (authorization, workspaceId, programmeId) => {
    const { data, error } = await caller(authorization).from('programme_hub_programmes').select('id')
      .eq('workspace_id', workspaceId).eq('id', programmeId).maybeSingle();
    return !error && data?.id === programmeId;
  },
  save: async (input) => {
    const { data, error } = await service.rpc('save_rev_programme_employer_engagement', input);
    if (error || !data) throw new Error('save unavailable');
    const raw = data as Record<string, unknown>;
    return {
      operation: raw.operation,
      recordId: raw.record_id,
      workspaceId: raw.workspace_id,
      programmeId: raw.programme_id,
      version: raw.version,
      duplicate: raw.duplicate,
    };
  },
}));
