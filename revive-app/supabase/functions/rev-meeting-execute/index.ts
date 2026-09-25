import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleMeetingExecutionHttp } from '../_shared/meetingExecutionHttpBoundary.ts';
import { createMeetingExecutionServerBoundary, type MeetingServerDependencies } from '../_shared/meetingExecutionServerDependencies.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowedOrigin = Deno.env.get('REV_MEETING_EXECUTION_ALLOWED_ORIGIN') ?? '';

Deno.serve(request => handleMeetingExecutionHttp(request, {
  allowedOrigin,
  execute: async (input, authorization) => {
    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false } });
    const trustedClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false } });
    return createMeetingExecutionServerBoundary({
      callerClient, trustedClient, getEnvironment: key => Deno.env.get(key),
    } as unknown as MeetingServerDependencies)(input);
  },
}));
