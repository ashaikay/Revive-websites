import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  acquireMicrosoftGraphAccessToken,
} from '../_shared/microsoftGraphAuth.ts';

import {
  readMicrosoftGraphInbox,
} from './microsoftGraphInbox.ts';

import {
  matchInboundContact,
  type InboundContactCandidate,
} from './inboundContactMatcher.ts';

import {
  persistInboundEmail,
} from './inboundEmailPersistence.ts';

import {
  classifyInboundEmail,
} from './inboundEmailClassifier.ts';
import { detectInboundReplyIntent } from './inboundReplyIntent.ts';
import { recommendInboundAction } from './inboundActionRecommender.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonHeaders = {
  ...corsHeaders,
  'Content-Type': 'application/json',
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

Deno.serve(async (request: Request) => {
    if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }
    if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed.' },
      405,
    );
  }

  const authorization = request.headers.get('Authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse(
      { error: 'Authentication required.' },
      401,
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(
      { error: 'Server configuration is incomplete.' },
      500,
    );
  }

  /*
   * Caller-scoped client.
   *
   * This client is used to prove the caller's identity and workspace
   * membership before any service-role database access occurs.
   */
  const callerClient = createClient(
    supabaseUrl,
    anonKey,
    {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
      auth: {
        persistSession: false,
      },
    },
  );

  const {
    data: { user },
    error: userError,
  } = await callerClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse(
      { error: 'Authentication failed.' },
      401,
    );
  }

  let payload: {
    workspaceId?: unknown;
  };

  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      { error: 'Invalid JSON body.' },
      400,
    );
  }

  const workspaceId =
    typeof payload.workspaceId === 'string'
      ? payload.workspaceId.trim()
      : '';

  if (!workspaceId) {
    return jsonResponse(
      { error: 'workspaceId is required.' },
      400,
    );
  }

  const { data: membership, error: membershipError } =
    await callerClient
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

  if (
    membershipError ||
    !membership ||
    !['owner', 'admin'].includes(membership.role)
  ) {
    return jsonResponse(
      { error: 'Workspace access denied.' },
      403,
    );
  }

  const tenantId = Deno.env.get('MICROSOFT_GRAPH_TENANT_ID');
  const clientId = Deno.env.get('MICROSOFT_GRAPH_CLIENT_ID');
  const clientSecret = Deno.env.get(
    'MICROSOFT_GRAPH_CLIENT_SECRET',
  );
if (
    !tenantId ||
    !clientId ||
    !clientSecret
  ) {
    return jsonResponse(
      { error: 'Microsoft Graph configuration is incomplete.' },
      500,
    );
  }

  /*
   * Service-role access begins only after the caller has been
   * authenticated and authorised for this workspace.
   */
  const serviceClient = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
      },
    },
  );

  try {
    const { data: mailbox, error: mailboxError } =
      await serviceClient
        .from('workspace_email_mailboxes')
        .select('mailbox_user_id, mailbox_email, enabled')
        .eq('workspace_id', workspaceId)
        .eq('provider_key', 'microsoft_graph')
        .eq('enabled', true)
        .maybeSingle();

    if (mailboxError || !mailbox?.mailbox_user_id) {
      return jsonResponse(
        { error: 'No enabled mailbox is configured for this workspace.' },
        403,
      );
    }

    const mailboxUserId = mailbox.mailbox_user_id;

    const token = await acquireMicrosoftGraphAccessToken({
      tenantId,
      clientId,
      clientSecret,
    });

    /*
     * Microsoft Graph boundary is GET-only.
     * No send/reply/delete/move/mark-read operation exists here.
     */
    const messages = await readMicrosoftGraphInbox({
      accessToken: token.accessToken,
      mailboxUserId,
    });

    let stored = 0;
    let alreadyStored = 0;
    let matched = 0;
    let needsReview = 0;
    let latestCustomerSignal = null;

    for (const message of messages) {
      const { data: contacts, error: contactsError } =
        await serviceClient
          .from('contacts')
          .select('id, workspace_id, email')
          .eq('workspace_id', workspaceId)
          .ilike('email', message.senderEmail);

      if (contactsError) {
        throw new Error(
          `Failed to load workspace contacts: ${contactsError.message}`,
        );
      }

      const contactMatch = matchInboundContact(
        workspaceId,
        message.senderEmail,
        (contacts ?? []) as InboundContactCandidate[],
      );

      const classification = classifyInboundEmail({
        senderEmail: message.senderEmail,
        subject: message.subject,
        matchedContactId:
          contactMatch.status === 'matched'
            ? contactMatch.contactId
            : null,
      });

      console.info('REV_INBOUND_CLASSIFICATION', {
        workspaceId,
        providerMessageId: message.providerMessageId,
        classification: classification.classification,
        confidence: classification.confidence,
        reason: classification.reason,
      });

      const replyIntent =
        classification.classification === 'customer_opportunity'
          ? detectInboundReplyIntent({
              subject: message.subject,
              bodyText: message.bodyText,
            })
          : null;

      const recommendedAction =
        replyIntent
          ? recommendInboundAction(replyIntent)
          : null;

      if (
        replyIntent &&
        recommendedAction &&
        (
          !latestCustomerSignal ||
          new Date(message.receivedAt).getTime() >
            new Date(latestCustomerSignal.receivedAt).getTime()
        )
      ) {
        latestCustomerSignal = {
          senderEmail: message.senderEmail,
          subject: message.subject,
          classification: classification.classification,
          intent: replyIntent.intent,
          intentConfidence: replyIntent.confidence,
          recommendedAction: recommendedAction.action,
          recommendedActionReason: recommendedAction.reason,
          requiresApproval: recommendedAction.requiresApproval,
          receivedAt: message.receivedAt,
        };
      }

      const result = await persistInboundEmail(
        serviceClient,
        {
          workspaceId,
          message,
          contactMatch,
          classification,
          replyIntent,
          recommendedAction,
        },
      );

      if (result.status === 'stored') {
        stored += 1;
      } else {
        alreadyStored += 1;
      }

      if (result.processingStatus === 'matched') {
        matched += 1;
      } else {
        needsReview += 1;
      }
    }

    return jsonResponse({
      status: 'completed',
      mailboxMutation: false,
      messagesRead: messages.length,
      stored,
      alreadyStored,
      matched,
      needsReview,
      latestCustomerSignal,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Inbound email processing failed.';

    console.error('REV_INBOUND_EMAIL_ERROR', message);

    return jsonResponse(
      {
        error: 'Inbound email processing failed.',
      },
      500,
    );
  }
});







