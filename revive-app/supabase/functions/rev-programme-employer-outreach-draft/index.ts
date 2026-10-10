import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleEmployerOutreachDraft } from './employerOutreachBoundary.ts';
import { prepareEmployerOutreachWithOpenAI } from './openAiEmployerOutreachProvider.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const apiKey = Deno.env.get('OPENAI_API_KEY')?.trim() ?? '';
const enabled = Deno.env.get('REV_PROGRAMME_EMPLOYER_OUTREACH_AI_ENABLED')?.trim().toLowerCase() === 'true';
const configuredLimit = Number(Deno.env.get('REV_PROGRAMME_EMPLOYER_OUTREACH_DAILY_LIMIT') ?? '10');
const dailyLimit = Number.isSafeInteger(configuredLimit) && configuredLimit >= 1 && configuredLimit <= 50 ? configuredLimit : 10;
const model = 'gpt-4.1-mini-2025-04-14';
const caller = (authorization: string) => createClient(url, anonKey, {
  global: { headers: { Authorization: authorization } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const claim = (value: Record<string, unknown>) => ({
  attemptId: value.attempt_id as string,
  status: value.status as 'claimed' | 'succeeded' | 'failed',
  shouldAttempt: value.should_attempt as boolean,
  errorCode: value.error_code as string | null,
  draft: value.draft as never,
  source: value.source as never,
});

Deno.serve((request) => handleEmployerOutreachDraft(request, {
  allowedOrigin: Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
  providerConfigured: enabled && Boolean(apiKey),
  model,
  dailyLimit,
  getUserId: async (authorization) => {
    const { data, error } = await caller(authorization).auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
  canAccessProgramme: async (authorization, workspaceId, programmeId) => {
    const { data, error } = await caller(authorization).from('programme_hub_programmes').select('id')
      .eq('workspace_id', workspaceId).eq('id', programmeId).maybeSingle();
    return !error && data?.id === programmeId;
  },
  claim: async (input) => {
    const { data, error } = await service.rpc('claim_rev_programme_employer_outreach_draft', {
      target_workspace_id: input.workspaceId,
      initiating_user_id: input.userId,
      target_request_id: input.requestId,
      target_programme_id: input.programmeId,
      target_employer_id: input.employerId,
      target_contact_id: input.contactId,
      expected_employer_version: input.employerVersion,
      expected_settings_version: input.settingsVersion,
      expected_contact_version: input.contactVersion,
      daily_limit: input.dailyLimit,
    });
    if (error || !data) throw new Error('claim unavailable');
    return claim(data as Record<string, unknown>);
  },
  prepare: (source) => prepareEmployerOutreachWithOpenAI(source, apiKey),
  complete: async (input) => {
    const { data, error } = await service.rpc('complete_rev_programme_employer_outreach_draft', {
      target_workspace_id: input.workspaceId,
      initiating_user_id: input.userId,
      target_request_id: input.requestId,
      target_subject: input.subject,
      target_body: input.body,
      target_model: input.model,
      target_provider_response_id: input.providerResponseId,
      target_input_tokens: input.inputTokens,
      target_output_tokens: input.outputTokens,
    });
    if (error || !data) throw new Error('completion unavailable');
    return claim(data as Record<string, unknown>);
  },
  fail: async (input) => {
    const { data, error } = await service.rpc('fail_rev_programme_employer_outreach_draft', {
      target_workspace_id: input.workspaceId,
      initiating_user_id: input.userId,
      target_request_id: input.requestId,
      target_error_code: input.errorCode,
    });
    if (error || !data) throw new Error('failure unavailable');
    return claim(data as Record<string, unknown>);
  },
}));
