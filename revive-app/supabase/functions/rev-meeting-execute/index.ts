import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleMeetingExecutionHttp } from '../_shared/meetingExecutionHttpBoundary.ts';
import { createMeetingExecutionServerBoundary, type MeetingServerDependencies } from '../_shared/meetingExecutionServerDependencies.ts';
import { createMeetingProviderHttpService } from '../_shared/meetingProviderHttpService.ts';
import { createTrustedMeetingExecutionReadModel, type TrustedMeetingReadClient } from '../_shared/trustedMeetingExecutionReadModel.ts';
import { createTrustedMeetingProviderServer } from '../_shared/trustedMeetingProviderServer.ts';
import type { MeetingProviderAttemptClient } from '../_shared/trustedMeetingProviderAttempt.ts';
import { resolveMeetingProviderLiveWorkspace } from '../_shared/meetingProviderActivation.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowedOrigin = Deno.env.get('REV_MEETING_EXECUTION_ALLOWED_ORIGIN') ?? '';
const liveWorkspaceId = resolveMeetingProviderLiveWorkspace(
  Deno.env.get('REV_MEETING_PROVIDER_LIVE_WORKSPACE_ID'),
  Deno.env.get('REV_CALENDAR_AVAILABILITY_WORKSPACE_ID'),
);

Deno.serve(request => handleMeetingExecutionHttp(request, {
  allowedOrigin,
  execute: async (input, authorization) => {
    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false } });
    const trustedClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false } });
    const executeDisabled = createMeetingExecutionServerBoundary({
      callerClient,
    } as unknown as MeetingServerDependencies);
    const providerClient = trustedClient as unknown as TrustedMeetingReadClient & MeetingProviderAttemptClient;
    return createMeetingProviderHttpService({
      executeDisabled,
      loadSnapshot: createTrustedMeetingExecutionReadModel(providerClient),
      createProvider: () => createTrustedMeetingProviderServer({
        trustedClient: providerClient,
        liveWorkspaceId: liveWorkspaceId!,
        getEnvironment: key => Deno.env.get(key),
      }),
    }, liveWorkspaceId)(input);
  },
}, liveWorkspaceId));
