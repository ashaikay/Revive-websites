export interface MicrosoftGraphInboxConfig {
  accessToken: string;
  mailboxUserId: string;
}

export interface MicrosoftGraphInboxMessage {
  providerMessageId: string;
  providerConversationId: string | null;
  internetMessageId: string | null;
  subject: string;
  bodyText: string;
  senderEmail: string;
  recipientEmails: string[];
  receivedAt: string;
  isRead: boolean;
}

export class MicrosoftGraphInboxError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'MicrosoftGraphInboxError';
    this.status = status;
  }
}

type GraphEmailAddress = {
  emailAddress?: {
    address?: unknown;
  };
};

type GraphMessage = {
  id?: unknown;
  conversationId?: unknown;
  internetMessageId?: unknown;
  subject?: unknown;
  body?: {
    content?: unknown;
  };
  from?: GraphEmailAddress;
  toRecipients?: GraphEmailAddress[];
  receivedDateTime?: unknown;
  isRead?: unknown;
};

type GraphMessageResponse = {
  value?: unknown;
};

function requireValue(value: string, name: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new MicrosoftGraphInboxError(
      `Microsoft Graph ${name} is required.`,
    );
  }

  return normalized;
}

function readEmailAddress(value?: GraphEmailAddress): string {
  const address = value?.emailAddress?.address;

  return typeof address === 'string'
    ? address.trim().toLowerCase()
    : '';
}

function mapGraphMessage(
  message: GraphMessage,
): MicrosoftGraphInboxMessage | null {
  const providerMessageId =
    typeof message.id === 'string' ? message.id.trim() : '';

  const senderEmail = readEmailAddress(message.from);

  const receivedAt =
    typeof message.receivedDateTime === 'string'
      ? message.receivedDateTime.trim()
      : '';

  // Do not ingest malformed/identity-incomplete messages.
  if (!providerMessageId || !senderEmail || !receivedAt) {
    return null;
  }

  const recipients = Array.isArray(message.toRecipients)
    ? message.toRecipients
        .map(readEmailAddress)
        .filter((email) => Boolean(email))
    : [];

  return {
    providerMessageId,
    providerConversationId:
      typeof message.conversationId === 'string' &&
      message.conversationId.trim()
        ? message.conversationId.trim()
        : null,

    internetMessageId:
      typeof message.internetMessageId === 'string' &&
      message.internetMessageId.trim()
        ? message.internetMessageId.trim()
        : null,

    subject:
      typeof message.subject === 'string'
        ? message.subject
        : '',

    bodyText:
      typeof message.body?.content === 'string'
        ? message.body.content
        : '',

    senderEmail,
    recipientEmails: recipients,
    receivedAt,
    isRead:
      typeof message.isRead === 'boolean'
        ? message.isRead
        : false,
  };
}

/*
 * READ-ONLY Microsoft Graph inbox boundary.
 *
 * This function:
 * - reads Inbox messages only;
 * - does not send or reply;
 * - does not delete or move messages;
 * - does not mark messages as read;
 * - does not mutate the mailbox.
 *
 * Database persistence and workspace/contact matching are deliberately
 * outside this provider boundary.
 */
export async function readMicrosoftGraphInbox(
  config: MicrosoftGraphInboxConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<MicrosoftGraphInboxMessage[]> {
  const accessToken = requireValue(
    config.accessToken,
    'access token',
  );

  const mailboxUserId = requireValue(
    config.mailboxUserId,
    'mailbox user ID',
  );

  const selectFields = [
    'id',
    'conversationId',
    'internetMessageId',
    'subject',
    'body',
    'from',
    'toRecipients',
    'receivedDateTime',
    'isRead',
  ].join(',');

  const query = new URLSearchParams({
    '$select': selectFields,
    '$orderby': 'receivedDateTime desc',
    '$top': '25',
  });

  const url =
    `https://graph.microsoft.com/v1.0/users/` +
    `${encodeURIComponent(mailboxUserId)}/mailFolders/inbox/messages?` +
    query.toString();

  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        Prefer: 'outlook.body-content-type="text"',
      },
    });
  } catch {
    throw new MicrosoftGraphInboxError(
      'Microsoft Graph inbox request failed.',
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new MicrosoftGraphInboxError(
        'Microsoft Graph authentication or mailbox read authorization failed.',
        response.status,
      );
    }

    if (response.status === 429) {
      throw new MicrosoftGraphInboxError(
        'Microsoft Graph inbox rate limit reached.',
        response.status,
      );
    }

    throw new MicrosoftGraphInboxError(
      `Microsoft Graph inbox request failed with HTTP ${response.status}.`,
      response.status,
    );
  }

  let payload: GraphMessageResponse;

  try {
    payload = await response.json() as GraphMessageResponse;
  } catch {
    throw new MicrosoftGraphInboxError(
      'Microsoft Graph inbox returned an invalid response.',
      response.status,
    );
  }

  if (!Array.isArray(payload.value)) {
    throw new MicrosoftGraphInboxError(
      'Microsoft Graph inbox response does not contain a message list.',
      response.status,
    );
  }

  return payload.value
    .map((item) =>
      item && typeof item === 'object'
        ? mapGraphMessage(item as GraphMessage)
        : null
    )
    .filter(
      (message): message is MicrosoftGraphInboxMessage =>
        message !== null,
    );
}