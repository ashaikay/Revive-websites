import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  handleCalendarAvailability,
  isCalendarAvailabilityEnabled,
  type CalendarAvailabilityDependencies,
} from './calendarAvailabilityBoundary.ts';
import { readMicrosoftGraphPrimaryCalendarAvailability } from '../_shared/microsoftGraphAvailability.ts';
import { resolveTrustedCalendarAvailability } from './trustedCalendarAvailabilityResolver.ts';
import { createSelectedCalendarAvailabilityService } from './selectedCalendarAvailabilityService.ts';
import { readMicrosoftGraphSelectedCalendarAvailability } from '../_shared/microsoftGraphSelectedCalendarAvailability.ts';
import { refreshCalendarDiscoveryToken } from '../rev-calendar-discover/calendarDiscoveryWorkflow.ts';
import { validateOAuthTokenConfiguration } from '../rev-calendar-oauth-complete/calendarOAuthCompletion.ts';
import { buildBusinessHoursAvailabilityWindows } from './businessHoursPolicy.ts';
import { withWorkspaceBusinessHours } from './workspaceBusinessHours.ts';

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
  isCalendarAvailabilityEnabled: () => isCalendarAvailabilityEnabled(
    Deno.env.get('REV_CALENDAR_AVAILABILITY_ENABLED'),
  ),
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
  resolveTrustedCalendarAvailability,
  // Explicit opt-in for customer-selected read-only calendars. Never falls back on failure.
  resolveSelectedCalendarAvailability: Deno.env.get('REV_CALENDAR_AVAILABILITY_SELECTED_ENABLED') === 'true'
    ? async (workspaceId, searchStartAt, searchEndAt, timezone, userId) => {
      const config = {
        clientId: Deno.env.get('REV_CALENDAR_OAUTH_CLIENT_ID') ?? '',
        clientSecret: Deno.env.get('REV_CALENDAR_OAUTH_CLIENT_SECRET') ?? '',
        authority: Deno.env.get('REV_CALENDAR_OAUTH_AUTHORITY') ?? '',
        redirectUri: Deno.env.get('REV_CALENDAR_OAUTH_REDIRECT_URI') ?? '',
      };
      validateOAuthTokenConfiguration(config);
      const url = Deno.env.get('SUPABASE_URL');
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !key) throw new Error('Selected calendar unavailable.');
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      return withWorkspaceBusinessHours(workspaceId, timezone, async (workspace, columns) => {
        const { data, error } = await client.from('workspace_calendar_business_hours').select(columns).eq('workspace_id', workspace);
        if (error) throw new Error('Workspace business hours unavailable.');
        return data;
      }, async (policy) => {
      const service = createSelectedCalendarAvailabilityService({
        client,
        refresh: (refreshToken) => refreshCalendarDiscoveryToken(config, refreshToken),
        read: readMicrosoftGraphSelectedCalendarAvailability,
        businessWindows: (selectedTimezone, startAt, endAt) => {
          if (selectedTimezone !== policy.timezone) throw new Error('Workspace timezone mismatch.');
          return buildBusinessHoursAvailabilityWindows({
            workingDays: policy.workingDays.join(','),
            businessStartLocal: policy.startLocal,
            businessEndLocal: policy.endLocal,
            timezone: policy.timezone,
          }, startAt, endAt);
        },
      });
      return service({ workspaceId, userId, searchStartAt, searchEndAt, timezone });
      });
    }
    : undefined,
  readBusyIntervals: readMicrosoftGraphPrimaryCalendarAvailability,
  now: () => new Date().toISOString(),
};

Deno.serve((request) => handleCalendarAvailability(request, dependencies));