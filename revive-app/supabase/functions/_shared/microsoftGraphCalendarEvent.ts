import type {
  ApprovedCalendarEventSnapshot,
} from '../../../src/domain/calendarEventExecution.ts';

export interface MicrosoftGraphCalendarEventRequest {
  accessToken: string;
  workspaceId: string;
  trustedWorkspaceId: string;
  mailboxUserPrincipalName: string;
  trustedMailboxUserPrincipalName: string;
  idempotencyKey: string;
  snapshot: ApprovedCalendarEventSnapshot;
}

export interface MicrosoftGraphCalendarEventResult {
  provider: 'microsoft_graph';
  outcome: 'created';
  providerEventReference: string;
  actualCost: 0;
}

export class MicrosoftGraphCalendarEventError extends Error {
  readonly kind:
    | 'invalid_request'
    | 'provider_rejected'
    | 'rate_limited'
    | 'outcome_unknown'
    | 'invalid_payload';

  readonly status?: number;

  constructor(
    kind: MicrosoftGraphCalendarEventError['kind'],
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'MicrosoftGraphCalendarEventError';
    this.kind = kind;
    this.status = status;
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function required(value: string, name: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new MicrosoftGraphCalendarEventError(
      'invalid_request',
      `${name} is required.`,
    );
  }

  return normalized;
}

function validateSnapshot(
  snapshot: ApprovedCalendarEventSnapshot,
): void {
  const start = Date.parse(snapshot.startAt);
  const end = Date.parse(snapshot.endAt);

  if (
    !snapshot.title?.trim() ||
    snapshot.title.trim().length > 120
  ) {
    throw new MicrosoftGraphCalendarEventError(
      'invalid_request',
      'Approved event title is invalid.',
    );
  }

  if (!EMAIL_PATTERN.test(snapshot.attendeeEmail?.trim())) {
    throw new MicrosoftGraphCalendarEventError(
      'invalid_request',
      'Approved attendee email is invalid.',
    );
  }

  if (
    !UTC_PATTERN.test(snapshot.startAt) ||
    !UTC_PATTERN.test(snapshot.endAt) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end
  ) {
    throw new MicrosoftGraphCalendarEventError(
      'invalid_request',
      'Approved event interval is invalid.',
    );
  }

  try {
    Intl.DateTimeFormat('en-GB', {
      timeZone: snapshot.timezone,
    });
  } catch {
    throw new MicrosoftGraphCalendarEventError(
      'invalid_request',
      'Approved event timezone is invalid.',
    );
  }

  if (
    !['online', 'phone', 'in_person'].includes(
      snapshot.meetingMethod,
    ) ||
    snapshot.locationDetails.length > 240 ||
    snapshot.notes.length > 1000
  ) {
    throw new MicrosoftGraphCalendarEventError(
      'invalid_request',
      'Approved event details are invalid.',
    );
  }
}

export async function createMicrosoftGraphCalendarEvent(
  request: MicrosoftGraphCalendarEventRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<MicrosoftGraphCalendarEventResult> {
  const accessToken = required(
    request.accessToken,
    'Microsoft Graph access token',
  );

  const workspaceId = required(
    request.workspaceId,
    'Workspace ID',
  );

  const trustedWorkspaceId = required(
    request.trustedWorkspaceId,
    'Trusted workspace ID',
  );

  const mailbox = required(
    request.mailboxUserPrincipalName,
    'Mailbox',
  );

  const trustedMailbox = required(
    request.trustedMailboxUserPrincipalName,
    'Trusted mailbox',
  );

  const idempotencyKey = required(
    request.idempotencyKey,
    'Idempotency key',
  ).toLowerCase();

  if (
    workspaceId !== trustedWorkspaceId ||
    mailbox.toLowerCase() !== trustedMailbox.toLowerCase()
  ) {
    throw new MicrosoftGraphCalendarEventError(
      'invalid_request',
      'Calendar event binding is outside the trusted workspace.',
    );
  }

  if (!SHA256_PATTERN.test(idempotencyKey)) {
    throw new MicrosoftGraphCalendarEventError(
      'invalid_request',
      'A valid deterministic idempotency key is required.',
    );
  }

  validateSnapshot(request.snapshot);

  const snapshot = request.snapshot;

  const body = {
    subject: snapshot.title.trim(),
    body: {
      contentType: 'text',
      content: snapshot.notes.trim(),
    },
    start: {
      dateTime: snapshot.startAt,
      timeZone: 'UTC',
    },
    end: {
      dateTime: snapshot.endAt,
      timeZone: 'UTC',
    },
    attendees: [
      {
        emailAddress: {
          address:
            snapshot.attendeeEmail.trim().toLowerCase(),
        },
        type: 'required',
      },
    ],
    location: {
      displayName: snapshot.locationDetails.trim(),
    },
    allowNewTimeProposals: false,
    responseRequested: true,
    transactionId: idempotencyKey,
  };

  const url =
    `https://graph.microsoft.com/v1.0/users/` +
    `${encodeURIComponent(mailbox)}/calendar/events`;

  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new MicrosoftGraphCalendarEventError(
      'outcome_unknown',
      'Microsoft Graph event creation outcome is unknown.',
    );
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new MicrosoftGraphCalendarEventError(
        'rate_limited',
        'Microsoft Graph event creation was rate limited.',
        429,
      );
    }

    throw new MicrosoftGraphCalendarEventError(
      'provider_rejected',
      'Microsoft Graph rejected event creation.',
      response.status,
    );
  }

  let payload: { id?: unknown };

  try {
    payload =
      (await response.json()) as { id?: unknown };
  } catch {
    throw new MicrosoftGraphCalendarEventError(
      'invalid_payload',
      'Microsoft Graph returned an invalid event response.',
      response.status,
    );
  }

  if (
    response.status !== 201 ||
    typeof payload.id !== 'string' ||
    !payload.id.trim()
  ) {
    throw new MicrosoftGraphCalendarEventError(
      'invalid_payload',
      'Microsoft Graph event response is incomplete.',
      response.status,
    );
  }

  return {
    provider: 'microsoft_graph',
    outcome: 'created',
    providerEventReference: payload.id,
    actualCost: 0,
  };
}