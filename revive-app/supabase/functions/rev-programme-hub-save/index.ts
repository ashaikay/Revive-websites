import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  classifyProgrammeHubDatabaseError,
  handleProgrammeHubSave,
} from './programmeHubBoundary.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const caller = (authorization: string) => createClient(url, anonKey, {
  global: { headers: { Authorization: authorization } },
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((request) => handleProgrammeHubSave(request, {
  allowedOrigin: Deno.env.get('REV_PROGRAMME_HUB_ALLOWED_ORIGINS') ?? Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
  getUserId: async (authorization) => {
    const { data, error } = await caller(authorization).auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
  canWriteWorkspace: async (authorization, workspaceId, userId) => {
    const { data, error } = await caller(authorization)
      .from('workspace_members')
      .select('role,status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    return !error && data?.status === 'active' && ['owner', 'admin', 'member'].includes(data.role);
  },
  save: async (input) => {
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = input.target_operation === 'participant_note'
      ? await service.rpc('save_rev_programme_hub_participant_note', {
          target_workspace_id: input.target_workspace_id,
          initiating_user_id: input.initiating_user_id,
          target_request_id: input.target_request_id,
          target_programme_id: input.target_programme_id,
          target_participant_id: input.target_payload.participantId,
          note_body: input.target_payload.body,
        })
      : input.target_operation === 'participant_contact'
        ? await service.rpc('save_rev_programme_hub_participant_contact', {
            target_workspace_id: input.target_workspace_id,
            initiating_user_id: input.initiating_user_id,
            target_request_id: input.target_request_id,
            target_programme_id: input.target_programme_id,
            target_record_id: input.target_record_id,
            expected_version: input.expected_version,
            target_payload: input.target_payload,
          })
        : await service.rpc('save_rev_programme_hub_record', input);
    if (error) {
      const failure = classifyProgrammeHubDatabaseError(input.target_operation, error);
      console.error('programme_hub_save_rpc_rejected', JSON.stringify({
        operation: input.target_operation,
        postgresCode: typeof error.code === 'string' ? error.code : null,
        errorCode: failure.errorCode,
        responseType: typeof error,
        topLevelKeys: error && typeof error === 'object' ? Object.keys(error).sort() : [],
      }));
      throw failure;
    }
    if (!data) throw new Error('Programme save unavailable');
    return data;
  },
}));
