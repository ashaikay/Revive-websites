export interface MicrosoftGraphSelectedCalendar {
  id: string;
  workspaceId: string;
  connectionId: string;
  provider: 'microsoft_graph';
  providerCalendarReference: string;
  timezone: string;
}

export interface MicrosoftGraphAvailabilityRequest {
  accessToken: string;
  workspaceId: string;
  selectedCalendarId: string;
  selectedCalendar: MicrosoftGraphSelectedCalendar;
  mailboxUserPrincipalName: string;
  searchStartAt: string;
  searchEndAt: string;
  timezone: string;
}

export interface BusyInterval {
  startAt: string;
  endAt: string;
}

export class MicrosoftGraphAvailabilityError extends Error {
  readonly kind: 'invalid_request' | 'provider_rejected' | 'rate_limited' | 'read_outcome_unknown' | 'invalid_payload';
  readonly status?: number;

  constructor(
    kind: MicrosoftGraphAvailabilityError['kind'],
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'MicrosoftGraphAvailabilityError';
    this.kind = kind;
    this.status = status;
  }
}

type GraphScheduleItem = {
  status?: unknown;
  start?: { dateTime?: unknown; timeZone?: unknown };
  end?: { dateTime?: unknown; timeZone?: unknown };
};

type GraphScheduleResponse = {
  value?: Array<{ scheduleItems?: unknown }>;
};

function required(value: string, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new MicrosoftGraphAvailabilityError('invalid_request', `Microsoft Graph ${name} is required.`);
  }
  return normalized;
}

function utcInstant(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function graphUtcInstant(value: unknown, timeZone: unknown): string | null {
  if (timeZone !== 'UTC' || typeof value !== 'string') return null;
  const utcValue = value.endsWith('Z') ? value : `${value}Z`;
  return utcInstant(utcValue);
}

function normalizeScheduleItem(item: GraphScheduleItem): BusyInterval | null {
  const status = String(item.status);
  if (status === 'free') return null;
  if (!['tentative', 'busy', 'oof', 'workingElsewhere'].includes(status)) {
    throw new MicrosoftGraphAvailabilityError('invalid_payload', 'Microsoft Graph returned an unknown schedule status.');
  }
  const startAt = graphUtcInstant(item.start?.dateTime, item.start?.timeZone);
  const endAt = graphUtcInstant(item.end?.dateTime, item.end?.timeZone);
  if (!startAt || !endAt || Date.parse(startAt) >= Date.parse(endAt)) {
    throw new MicrosoftGraphAvailabilityError('invalid_payload', 'Microsoft Graph returned an invalid schedule item.');
  }
  return { startAt, endAt };
}

/*
 * This server-only adapter is injected into the controlled calendar boundary.
 * The boundary's disabled capability gate prevents it from running in production.
 * `workingElsewhere` is treated as busy because location/remote-work policy
 * cannot safely establish customer-meeting availability in this phase.
 */
export async function readMicrosoftGraphPrimaryCalendarAvailability(
  request: MicrosoftGraphAvailabilityRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<BusyInterval[]> {
  const accessToken = required(request.accessToken, 'access token');
  const workspaceId = required(request.workspaceId, 'workspace ID');
  const mailbox = required(request.mailboxUserPrincipalName, 'selected mailbox');
  const calendar = request.selectedCalendar;
  const searchStartAt = utcInstant(request.searchStartAt);
  const searchEndAt = utcInstant(request.searchEndAt);

  if (!searchStartAt || !searchEndAt || Date.parse(searchStartAt) >= Date.parse(searchEndAt)) {
    throw new MicrosoftGraphAvailabilityError('invalid_request', 'Microsoft Graph availability requires ordered UTC search instants.');
  }
  if (!request.timezone?.trim() || request.timezone !== calendar.timezone) {
    throw new MicrosoftGraphAvailabilityError('invalid_request', 'Selected calendar timezone is required and must match the request.');
  }
  if (calendar.workspaceId !== workspaceId || calendar.id !== request.selectedCalendarId || !calendar.connectionId) {
    throw new MicrosoftGraphAvailabilityError('invalid_request', 'Selected calendar is outside the requested workspace.');
  }
  if (calendar.provider !== 'microsoft_graph' || calendar.providerCalendarReference !== mailbox) {
    throw new MicrosoftGraphAvailabilityError('invalid_request', 'Only the explicitly selected Microsoft 365 primary mailbox calendar is supported.');
  }

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/calendar/getSchedule`;
  const body = {
    schedules: [mailbox],
    startTime: { dateTime: searchStartAt, timeZone: 'UTC' },
    endTime: { dateTime: searchEndAt, timeZone: 'UTC' },
    availabilityViewInterval: 30,
  };

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new MicrosoftGraphAvailabilityError('read_outcome_unknown', 'Microsoft Graph availability read outcome is unknown.');
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new MicrosoftGraphAvailabilityError('rate_limited', 'Microsoft Graph availability read was rate limited.', response.status);
    }
    throw new MicrosoftGraphAvailabilityError('provider_rejected', 'Microsoft Graph rejected the availability request.', response.status);
  }

  let payload: GraphScheduleResponse;
  try {
    payload = await response.json() as GraphScheduleResponse;
  } catch {
    throw new MicrosoftGraphAvailabilityError('invalid_payload', 'Microsoft Graph returned an invalid availability response.', response.status);
  }
  if (!Array.isArray(payload.value) || payload.value.length !== 1 || !Array.isArray(payload.value[0]?.scheduleItems)) {
    throw new MicrosoftGraphAvailabilityError('invalid_payload', 'Microsoft Graph availability response is incomplete.', response.status);
  }

  return payload.value[0].scheduleItems.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new MicrosoftGraphAvailabilityError('invalid_payload', 'Microsoft Graph returned an invalid schedule item.', response.status);
    }
    return normalizeScheduleItem(item as GraphScheduleItem);
  }).filter((item): item is BusyInterval => item !== null);
}