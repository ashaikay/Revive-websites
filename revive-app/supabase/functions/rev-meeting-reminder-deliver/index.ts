import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { acquireMicrosoftGraphAccessToken } from '../_shared/microsoftGraphAuth.ts';
import { sendMicrosoftGraphEmail } from '../rev-email-execute/microsoftGraphProvider.ts';
import {
  executeClaimedMeetingReminderEmail,
  type ClaimedMeetingReminderEmail,
} from './meetingReminderEmailOrchestrator.ts';
import { handleMeetingReminderDelivery } from './meetingReminderDeliveryBoundary.ts';

export const SEND_MEETING_REMINDER_EMAIL_CAPABILITY = 'SEND_MEETING_REMINDER_EMAIL';
const PROVIDER_EXECUTION_ENABLED = false;
const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const caller = (authorization: string) => createClient(url, anonKey, {
  global: { headers: { Authorization: authorization } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const service = () => createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((request) => handleMeetingReminderDelivery(request, {
  allowedOrigin: Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
  providerExecutionEnabled: PROVIDER_EXECUTION_ENABLED,
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
  approve: async (input) => {
    const { data, error } = await service().rpc('approve_rev_meeting_reminder_delivery', input);
    if (error || !data) throw new Error('Meeting reminder approval unavailable');
    return data;
  },
  deliver: async (input) => {
    const tenantId = Deno.env.get('MICROSOFT_GRAPH_TENANT_ID')?.trim() ?? '';
    const clientId = Deno.env.get('MICROSOFT_GRAPH_CLIENT_ID')?.trim() ?? '';
    const clientSecret = Deno.env.get('MICROSOFT_GRAPH_CLIENT_SECRET')?.trim() ?? '';
    const senderUserId = Deno.env.get('MICROSOFT_GRAPH_SENDER_USER_ID')?.trim() ?? '';
    if (!tenantId || !clientId || !clientSecret || !senderUserId) {
      throw new Error('Reminder sender configuration unavailable');
    }
    const auth = await acquireMicrosoftGraphAccessToken({ tenantId, clientId, clientSecret });
    if (!auth.accessToken?.trim()) throw new Error('Reminder sender authentication unavailable');

    const trusted = service();
    const { data, error } = await trusted.rpc('claim_rev_meeting_reminder_delivery', {
      target_workspace_id: input.workspaceId,
      initiating_user_id: input.userId,
      target_request_id: input.requestId,
      target_meeting_proposal_id: input.meetingProposalId,
      target_send_consent: input.sendConsent,
    });
    if (error || !data || typeof data !== 'object') {
      throw new Error('Meeting reminder provider claim unavailable');
    }
    const row = data as Record<string, unknown>;
    const claim: ClaimedMeetingReminderEmail = {
      deliveryId: String(row.id),
      requestFingerprint: String(row.request_fingerprint),
      status: row.status as ClaimedMeetingReminderEmail['status'],
      replayed: row.replayed === true,
      email: row.replayed === true ? undefined : {
        recipient: String(row.recipient),
        subject: String(row.subject),
        body: String(row.body),
      },
    };
    return executeClaimedMeetingReminderEmail(claim, {
      sendEmail: (email) => sendMicrosoftGraphEmail(email, {
        accessToken: auth.accessToken,
        senderUserId,
      }),
      recordResult: async (result) => {
        const { data: saved, error: saveError } = await trusted.rpc(
          'record_rev_meeting_reminder_delivery_result',
          {
            target_delivery_id: result.deliveryId,
            expected_request_fingerprint: result.requestFingerprint,
            target_provider_outcome: result.providerOutcome,
            target_result_summary: result.resultSummary,
            target_failure_code: result.failureCode,
            target_provider_reference: null,
          },
        );
        if (saveError || !saved) throw new Error('Reminder provider result unavailable');
        return saved;
      },
    });
  },
}));
