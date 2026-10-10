import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { discoverCompaniesHouseEmployers } from './companiesHouseEmployerDiscovery.ts';
import { handleEmployerDiscovery } from './employerDiscoveryBoundary.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const apiKey = Deno.env.get('COMPANIES_HOUSE_API_KEY')?.trim() ?? '';
const enabled = Deno.env.get('REV_PROGRAMME_EMPLOYER_DISCOVERY_ENABLED')?.trim().toLowerCase() === 'true';
const caller = (authorization: string) => createClient(url, anonKey, {
  global: { headers: { Authorization: authorization } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const claim = (value: Record<string, unknown>) => ({
  searchId: value.search_id as string,
  status: value.status as 'claimed' | 'succeeded' | 'failed',
  shouldAttempt: value.should_attempt as boolean,
  results: value.results as never,
  errorCode: value.error_code as string | null,
  retrievedAt: value.retrieved_at as string | null,
});

Deno.serve((request) => handleEmployerDiscovery(request, {
  allowedOrigin: Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
  providerConfigured: enabled && Boolean(apiKey),
  getUserId: async (authorization) => {
    const { data, error } = await caller(authorization).auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
  canAccessProgramme: async (authorization, workspaceId, programmeId) => {
    const client = caller(authorization);
    const { data, error } = await client.from('programme_hub_programmes').select('id')
      .eq('workspace_id', workspaceId).eq('id', programmeId).maybeSingle();
    return !error && data?.id === programmeId;
  },
  claim: async (input) => {
    const { data, error } = await service.rpc('claim_rev_programme_employer_discovery', {
      target_workspace_id: input.workspaceId,
      initiating_user_id: input.userId,
      target_request_id: input.requestId,
      target_programme_id: input.programmeId,
      target_filters: input.filters,
    });
    if (error || !data) throw new Error('claim unavailable');
    return claim(data as Record<string, unknown>);
  },
  search: (filters) => discoverCompaniesHouseEmployers(filters, apiKey),
  complete: async (input) => {
    const { data, error } = await service.rpc('complete_rev_programme_employer_discovery', {
      target_workspace_id: input.workspaceId,
      initiating_user_id: input.userId,
      target_request_id: input.requestId,
      target_results: input.results,
      target_retrieved_at: input.retrievedAt,
    });
    if (error || !data) throw new Error('completion unavailable');
    return claim(data as Record<string, unknown>);
  },
  fail: async (input) => {
    const { data, error } = await service.rpc('fail_rev_programme_employer_discovery', {
      target_workspace_id: input.workspaceId,
      initiating_user_id: input.userId,
      target_request_id: input.requestId,
      target_error_code: input.errorCode,
    });
    if (error || !data) throw new Error('failure unavailable');
    return claim(data as Record<string, unknown>);
  },
}));
