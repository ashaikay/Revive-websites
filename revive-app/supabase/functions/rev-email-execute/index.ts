import { createClient } from 'npm:@supabase/supabase-js@2';

import { fingerprintApprovedEmail } from '../_shared/approvedEmailFingerprint.ts';

import {
  createMicrosoftGraphExecutionDependencies,
  type MicrosoftGraphServerConfig,
} from './microsoftGraphExecutionDependencies.ts';

import {
  executeMicrosoftGraphEmail,
} from './microsoftGraphExecutionOrchestrator.ts';

/*
 * PHASE 4G.2B PROVIDER ACTIVATION GATE
 *
 * MUST remain false during implementation and validation.
 *
 * No service-role client, Microsoft authentication, provider claim,
 * Microsoft Graph invocation, or terminal provider result recording
 * is reachable while this is false.
 */
const PROVIDER_EXECUTION_ENABLED = false;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(
  status: number,
  body: Record<string, unknown>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return json(405, {
      error: 'Method not allowed.',
    });
  }

  try {
    const authorization =
      req.headers.get('Authorization');

    if (!authorization?.startsWith('Bearer ')) {
      return json(401, {
        error: 'Authentication required.',
      });
    }

    const supabaseUrl =
      Deno.env.get('SUPABASE_URL');

    const publicKey =
      Deno.env.get('SUPABASE_ANON_KEY') ??
      Deno.env.get('SUPABASE_PUBLISHABLE_KEY');

    if (!supabaseUrl || !publicKey) {
      return json(500, {
        error: 'Server configuration is incomplete.',
      });
    }

    /*
     * Caller-scoped client.
     *
     * This client carries the authenticated user's JWT and remains
     * subject to normal tenant RLS.
     */
    const userClient = createClient(
      supabaseUrl,
      publicKey,
      {
        global: {
          headers: {
            Authorization: authorization,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return json(401, {
        error: 'Invalid authentication.',
      });
    }

    /*
     * Caller supplies identity references only.
     *
     * Recipient, subject, body, approval state, action version,
     * provider and execution authority are derived server-side.
     */
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
        error:
          'workspaceId and actionId are required.',
      });
    }

    /*
     * Verify active workspace authority.
     */
    const {
      data: membership,
      error: membershipError,
    } = await userClient
      .from('workspace_members')
      .select('role,status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (
      membershipError ||
      !membership ||
      !['owner', 'admin'].includes(
        String(membership.role),
      )
    ) {
      return json(403, {
        error:
          'Active owner or admin role required.',
      });
    }

    /*
     * Load the workspace-scoped approved REV action.
     */
    const {
      data: action,
      error: actionError,
    } = await userClient
      .from('rev_actions')
      .select(
        'id,workspace_id,contact_id,action_type,title,description,status,execution_status,action_version',
      )
      .eq('workspace_id', workspaceId)
      .eq('id', actionId)
      .maybeSingle();

    if (actionError || !action) {
      return json(404, {
        error: 'Approved REV action not found.',
      });
    }

    if (
      action.action_type !== 'prepare_follow_up' ||
      action.status !== 'approved' ||
      action.execution_status !== 'not_executed'
    ) {
      return json(409, {
        error:
          'REV action is not currently eligible for email execution.',
      });
    }

    if (!action.contact_id) {
      return json(409, {
        error:
          'Approved follow-up has no workspace contact.',
      });
    }

    /*
     * Resolve the recipient from trusted workspace data.
     */
    const {
      data: contact,
      error: contactError,
    } = await userClient
      .from('contacts')
      .select('id,email')
      .eq('workspace_id', workspaceId)
      .eq('id', action.contact_id)
      .maybeSingle();

    if (contactError || !contact?.email) {
      return json(409, {
        error:
          'Workspace contact does not have a valid email source.',
      });
    }

    /*
     * Initial suppression check before reservation.
     *
     * A second trusted suppression check occurs immediately before
     * the irreversible provider claim when execution is activated.
     */
    const {
      data: suppression,
      error: suppressionError,
    } = await userClient
      .from('contact_suppressions')
      .select('reason')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', action.contact_id)
      .maybeSingle();

    if (suppressionError) {
      return json(500, {
        error:
          'Suppression status could not be verified.',
      });
    }

    if (suppression) {
      return json(409, {
        error:
          'Contact is suppressed from outreach.',
      });
    }

    const actionVersion =
      Number(action.action_version);

    if (
      !Number.isInteger(actionVersion) ||
      actionVersion < 1
    ) {
      return json(409, {
        error: 'REV action version is invalid.',
      });
    }

    /*
     * Bind the execution request to the exact trusted email snapshot.
     */
    const requestFingerprint =
      await fingerprintApprovedEmail({
        workspaceId,
        actionId,
        actionVersion,
        recipient: String(contact.email),
        subject: String(action.title),
        body: String(action.description),
      });

    const correlationId = crypto.randomUUID();

    /*
     * Durable reservation.
     *
     * The database independently revalidates:
     *
     * - workspace policy
     * - capability
     * - cost
     * - action state/version
     * - action material fingerprint
     * - fresh bound approval
     * - semantic idempotency
     */
    const {
      data: execution,
      error: reservationError,
    } = await userClient.rpc(
      'prepare_rev_action_execution',
      {
        target_workspace_id: workspaceId,
        target_action_id: actionId,
        target_idempotency_key:
          `send-approved-email:${actionId}:v${actionVersion}`,
        target_request_fingerprint:
          requestFingerprint,
        target_correlation_id: correlationId,
        target_capability:
          'SEND_APPROVED_EMAIL',
        target_risk_class:
          'external_communication',
        target_jurisdiction: 'GB',
        target_estimated_provider_cost: 0,
        target_provider_key:
          'microsoft_graph',
      },
    );

    if (reservationError || !execution) {
      return json(409, {
        error:
          'Trusted email execution reservation was not authorized.',
        providerInvoked: false,
        emailSent: false,
      });
    }

    /*
     * HARD PHASE 4G.2B SAFETY GATE
     *
     * This MUST remain before:
     *
     * - service-role client creation
     * - Microsoft credential access
     * - Microsoft authentication
     * - final trusted suppression recheck
     * - claim_rev_action_provider_attempt
     * - Microsoft Graph invocation
     * - record_email_execution_result
     *
     * A durable provider_not_invoked reservation may exist, but no
     * external communication can occur while this gate is disabled.
     */
    if (!PROVIDER_EXECUTION_ENABLED) {
      return json(200, {
        status: 'provider_disabled',
        displayStatus:
          'DRY RUN - NOTHING SENT',
        executionEnabled: false,
        providerInvoked: false,
        emailSent: false,
        executionId: execution.id,
        correlationId:
          execution.correlation_id,
        providerOutcome:
          execution.provider_outcome,
        workspaceId,
        actionId,
        actionVersion,
        recipientSource:
          'workspace_contact',
        suppressionChecked: true,
        durableReservation: true,
      });
    }

    /*
     * Everything below this point is trusted server-only execution.
     *
     * This code is structurally wired during Phase 4G.2B but remains
     * unreachable while PROVIDER_EXECUTION_ENABLED === false.
     */

    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const graphConfig: MicrosoftGraphServerConfig = {
      tenantId:
        Deno.env.get(
          'MICROSOFT_GRAPH_TENANT_ID',
        ) ?? '',
      clientId:
        Deno.env.get(
          'MICROSOFT_GRAPH_CLIENT_ID',
        ) ?? '',
      clientSecret:
        Deno.env.get(
          'MICROSOFT_GRAPH_CLIENT_SECRET',
        ) ?? '',
      senderUserId:
        Deno.env.get(
          'MICROSOFT_GRAPH_SENDER_USER_ID',
        ) ?? '',
    };

    if (!serviceRoleKey) {
      return json(503, {
        error:
          'Trusted provider execution is not configured.',
        executionEnabled: false,
        providerInvoked: false,
        emailSent: false,
      });
    }

    /*
     * Server-only privileged client.
     *
     * This key must never be exposed to the browser, request payload,
     * logs or response body.
     */
    const serviceClient = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    /*
     * Dependency creation authenticates with Microsoft BEFORE the
     * irreversible provider-attempt claim.
     *
     * Missing/invalid Microsoft configuration therefore fails before
     * the claim and before any email invocation.
     */
    const dependencies =
      await createMicrosoftGraphExecutionDependencies({
        serviceClient,
        workspaceId,
        contactId: String(action.contact_id),
        config: graphConfig,
      });

    /*
     * Orchestrator order:
     *
     * final suppression recheck
     * -> atomic provider claim
     * -> exactly one Graph sendMail invocation
     * -> exactly one terminal provider outcome
     *
     * provider_outcome_unknown is NEVER automatically retried.
     */
    const providerResult =
      await executeMicrosoftGraphEmail(
        {
          executionId: String(execution.id),
          requestFingerprint,
          email: {
            recipient: String(contact.email),
            subject: String(action.title),
            body: String(action.description),
          },
        },
        dependencies,
      );

    return json(200, {
      status: providerResult.providerOutcome,
      executionEnabled: true,
      providerInvoked: true,

      /*
       * acceptedByProvider is intentionally NOT represented as
       * delivery confirmation.
       */
      acceptedByProvider:
        providerResult.acceptedByProvider,
      deliveryConfirmed:
        providerResult.deliveryConfirmed,
      automaticRetryAllowed:
        providerResult.automaticRetryAllowed,

      executionId: String(execution.id),
      correlationId:
        execution.correlation_id,
      workspaceId,
      actionId,
      actionVersion,
    });
  } catch {
    /*
     * Fail closed without leaking credentials, provider response
     * bodies, internal database details, or recipient information.
     *
     * Once provider execution is eventually activated, operational
     * reconciliation must inspect durable execution state before any
     * further attempt. This endpoint never automatically retries.
     */
    return json(500, {
      error:
        'Trusted email execution request failed safely.',
      providerInvoked: 'unknown',
      emailSent: 'unknown',
      automaticRetryAllowed: false,
    });
  }
});
