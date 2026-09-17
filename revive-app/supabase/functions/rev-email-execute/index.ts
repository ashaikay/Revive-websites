import { createClient } from 'npm:@supabase/supabase-js@2';
import { fingerprintApprovedEmail } from '../_shared/approvedEmailFingerprint.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }

  try {
    const authorization = req.headers.get('Authorization');

    if (!authorization?.startsWith('Bearer ')) {
      return json(401, { error: 'Authentication required.' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const publicKey =
      Deno.env.get('SUPABASE_ANON_KEY') ??
      Deno.env.get('SUPABASE_PUBLISHABLE_KEY');

    if (!supabaseUrl || !publicKey) {
      return json(500, { error: 'Server configuration is incomplete.' });
    }

    const userClient = createClient(supabaseUrl, publicKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return json(401, { error: 'Invalid authentication.' });
    }

    const payload = await req.json().catch(() => null) as {
      workspaceId?: unknown;
      actionId?: unknown;
    } | null;

    const workspaceId =
      typeof payload?.workspaceId === 'string'
        ? payload.workspaceId.trim()
        : '';

    const actionId =
      typeof payload?.actionId === 'string'
        ? payload.actionId.trim()
        : '';

    if (!workspaceId || !actionId) {
      return json(400, {
        error: 'workspaceId and actionId are required.',
      });
    }

    const { data: membership, error: membershipError } = await userClient
      .from('workspace_members')
      .select('role,status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (
      membershipError ||
      !membership ||
      !['owner', 'admin'].includes(String(membership.role))
    ) {
      return json(403, {
        error: 'Active owner or admin role required.',
      });
    }

    const { data: action, error: actionError } = await userClient
      .from('rev_actions')
      .select(
        'id,workspace_id,contact_id,action_type,title,description,status,execution_status,action_version',
      )
      .eq('workspace_id', workspaceId)
      .eq('id', actionId)
      .maybeSingle();

    if (actionError || !action) {
      return json(404, { error: 'Approved REV action not found.' });
    }

    if (
      action.action_type !== 'prepare_follow_up' ||
      action.status !== 'approved' ||
      action.execution_status !== 'not_executed'
    ) {
      return json(409, {
        error: 'REV action is not currently eligible for email execution.',
      });
    }

    if (!action.contact_id) {
      return json(409, {
        error: 'Approved follow-up has no workspace contact.',
      });
    }

    const { data: contact, error: contactError } = await userClient
      .from('contacts')
      .select('id,email')
      .eq('workspace_id', workspaceId)
      .eq('id', action.contact_id)
      .maybeSingle();

    if (contactError || !contact?.email) {
      return json(409, {
        error: 'Workspace contact does not have a valid email source.',
      });
    }

    const { data: suppression, error: suppressionError } = await userClient
      .from('contact_suppressions')
      .select('reason')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', action.contact_id)
      .maybeSingle();

    if (suppressionError) {
      return json(500, {
        error: 'Suppression status could not be verified.',
      });
    }

    if (suppression) {
      return json(409, {
        error: 'Contact is suppressed from outreach.',
      });
    }

    const actionVersion = Number(action.action_version);

    const requestFingerprint = await fingerprintApprovedEmail({
      workspaceId,
      actionId,
      actionVersion,
      recipient: String(contact.email),
      subject: String(action.title),
      body: String(action.description),
    });

    const correlationId = crypto.randomUUID();

    const { data: execution, error: reservationError } =
      await userClient.rpc('prepare_rev_action_execution', {
        target_workspace_id: workspaceId,
        target_action_id: actionId,
        target_idempotency_key:
          `send-approved-email:${actionId}:v${actionVersion}`,
        target_request_fingerprint: requestFingerprint,
        target_correlation_id: correlationId,
        target_capability: 'SEND_APPROVED_EMAIL',
        target_risk_class: 'external_communication',
        target_jurisdiction: 'GB',
        target_estimated_provider_cost: 0,
        target_provider_key: 'microsoft_graph',
      });

    if (reservationError || !execution) {
      return json(409, {
        error: 'Trusted email execution reservation was not authorized.',
        providerInvoked: false,
        emailSent: false,
      });
    }

    /*
     * PHASE 4G.2B SAFETY GATE
     *
     * Reservation is now durable.
     * Provider claim and Microsoft Graph invocation remain unreachable.
     */
    return json(200, {
      status: 'provider_disabled',
      displayStatus: 'DRY RUN — NOTHING SENT',
      executionEnabled: false,
      providerInvoked: false,
      emailSent: false,
      executionId: execution.id,
      correlationId: execution.correlation_id,
      providerOutcome: execution.provider_outcome,
      workspaceId,
      actionId,
      actionVersion,
      recipientSource: 'workspace_contact',
      suppressionChecked: true,
      durableReservation: true,
    });
  } catch {
    return json(500, {
      error: 'Trusted email execution request failed safely.',
      providerInvoked: false,
      emailSent: false,
    });
  }
});
