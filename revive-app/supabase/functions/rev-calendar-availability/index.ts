import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  handleCalendarAvailability,
  type CalendarAvailabilityDependencies,
} from './calendarAvailabilityBoundary.ts';
import { readMicrosoftGraphPrimaryCalendarAvailability } from '../_shared/microsoftGraphAvailability.ts';

function callerClient(authorization: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!supabaseUrl || !anonKey) throw new Error('Supabase caller client is unavailable.');
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const dependencies: CalendarAvailabilityDependencies = {
  async getAuthenticatedUserId(authorization) {
    const { data, error } = await callerClient(authorization).auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
  async hasActiveWorkspaceMembership(authorization, workspaceId, userId) {
    const { data, error } = await callerClient(authorization)
      .from('workspace_members')
      .select('status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    return !error && data?.status === 'active';
  },
  async resolveTrustedCalendarAvailability() {
    /* No trusted calendar connection/selection store is authorized yet. */
    throw new Error('Trusted calendar resolver is not configured.');
  },
  readBusyIntervals: readMicrosoftGraphPrimaryCalendarAvailability,
  now: () => new Date().toISOString(),
};

Deno.serve((request) => handleCalendarAvailability(request, dependencies));