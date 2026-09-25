import { describe, expect, it, vi } from 'vitest';
import { CALENDAR_CAPABILITIES } from '@/services/calendarAvailabilityService';
import {
  createMicrosoftGraphCalendarEvent,
  MicrosoftGraphCalendarEventError,
  type MicrosoftGraphCalendarEventRequest,
} from '../../supabase/functions/_shared/microsoftGraphCalendarEvent';

const request: MicrosoftGraphCalendarEventRequest = {
  accessToken: 'server-secret-token',
  workspaceId: 'workspace-1',
  trustedWorkspaceId: 'workspace-1',
  mailboxUserPrincipalName: 'support@fatherslegacy.net',
  trustedMailboxUserPrincipalName:
    'support@fatherslegacy.net',
  idempotencyKey: 'a'.repeat(64),
  snapshot: {
    title: 'Approved discovery call',
    attendeeEmail: 'CUSTOMER@example.com',
    startAt: '2026-10-07T14:00:00.000Z',
    endAt: '2026-10-07T14:30:00.000Z',
    timezone: 'Europe/London',
    meetingMethod: 'online',
    locationDetails: 'Microsoft Teams',
    notes: 'Approved notes.',
  },
};

function response(
  status: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe(
  'Phase 5N isolated Microsoft Graph calendar event adapter',
  () => {
    it('constructs one trusted event request', async () => {
      const fetchImpl = vi.fn<typeof fetch>(
        async () =>
          response(201, {
            id: 'provider-event-1',
            webLink: 'not-returned',
          }),
      );

      await expect(
        createMicrosoftGraphCalendarEvent(
          request,
          fetchImpl,
        ),
      ).resolves.toEqual({
        provider: 'microsoft_graph',
        outcome: 'created',
        providerEventReference: 'provider-event-1',
        actualCost: 0,
      });

      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const [url, init] = fetchImpl.mock.calls[0];

      expect(url).toBe(
        'https://graph.microsoft.com/v1.0/users/' +
          'support%40fatherslegacy.net/calendar/events',
      );

      expect(init?.method).toBe('POST');

      expect(init?.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer server-secret-token',
        }),
      );

      expect(JSON.parse(String(init?.body))).toEqual({
        subject: 'Approved discovery call',
        body: {
          contentType: 'text',
          content: 'Approved notes.',
        },
        start: {
          dateTime: '2026-10-07T14:00:00.000Z',
          timeZone: 'UTC',
        },
        end: {
          dateTime: '2026-10-07T14:30:00.000Z',
          timeZone: 'UTC',
        },
        attendees: [
          {
            emailAddress: {
              address: 'customer@example.com',
            },
            type: 'required',
          },
        ],
        location: {
          displayName: 'Microsoft Teams',
        },
        allowNewTimeProposals: false,
        responseRequested: true,
        transactionId: 'a'.repeat(64),
      });
    });

    it('rejects untrusted bindings before fetch', async () => {
      const fetchImpl = vi.fn();

      await expect(
        createMicrosoftGraphCalendarEvent(
          {
            ...request,
            trustedWorkspaceId: 'workspace-2',
          },
          fetchImpl,
        ),
      ).rejects.toThrow(/trusted workspace/);

      await expect(
        createMicrosoftGraphCalendarEvent(
          {
            ...request,
            trustedMailboxUserPrincipalName:
              'other@example.com',
          },
          fetchImpl,
        ),
      ).rejects.toThrow(/trusted workspace/);

      await expect(
        createMicrosoftGraphCalendarEvent(
          {
            ...request,
            idempotencyKey: 'invalid',
          },
          fetchImpl,
        ),
      ).rejects.toThrow(/idempotency/);

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects invalid snapshots before fetch', async () => {
      const fetchImpl = vi.fn();

      await expect(
        createMicrosoftGraphCalendarEvent(
          {
            ...request,
            snapshot: {
              ...request.snapshot,
              attendeeEmail: 'invalid',
            },
          },
          fetchImpl,
        ),
      ).rejects.toThrow(/attendee/);

      await expect(
        createMicrosoftGraphCalendarEvent(
          {
            ...request,
            snapshot: {
              ...request.snapshot,
              endAt: request.snapshot.startAt,
            },
          },
          fetchImpl,
        ),
      ).rejects.toThrow(/interval/);

      await expect(
        createMicrosoftGraphCalendarEvent(
          {
            ...request,
            snapshot: {
              ...request.snapshot,
              timezone: 'Not/AZone',
            },
          },
          fetchImpl,
        ),
      ).rejects.toThrow(/timezone/);

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
      [429, 'rate_limited'],
      [403, 'provider_rejected'],
      [500, 'provider_rejected'],
    ] as const)(
      'maps HTTP %s to %s safely',
      async (status, kind) => {
        const fetchImpl = vi.fn(
          async () =>
            response(status, {
              error: {
                message:
                  'confidential provider detail',
              },
            }),
        );

        await expect(
          createMicrosoftGraphCalendarEvent(
            request,
            fetchImpl,
          ),
        ).rejects.toMatchObject({
          name: 'MicrosoftGraphCalendarEventError',
          kind,
          status,
        });
      },
    );

    it('treats transport failure as outcome unknown', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error('network detail');
      });

      await expect(
        createMicrosoftGraphCalendarEvent(
          request,
          fetchImpl,
        ),
      ).rejects.toMatchObject({
        name: 'MicrosoftGraphCalendarEventError',
        kind: 'outcome_unknown',
      });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('fails closed for invalid success responses', async () => {
      await expect(
        createMicrosoftGraphCalendarEvent(
          request,
          vi.fn(
            async () =>
              new Response('not-json', {
                status: 201,
              }),
          ),
        ),
      ).rejects.toMatchObject({
        kind: 'invalid_payload',
      });

      await expect(
        createMicrosoftGraphCalendarEvent(
          request,
          vi.fn(async () => response(201, {})),
        ),
      ).rejects.toMatchObject({
        kind: 'invalid_payload',
      });

      await expect(
        createMicrosoftGraphCalendarEvent(
          request,
          vi.fn(
            async () =>
              response(200, {
                id: 'wrong-status',
              }),
          ),
        ),
      ).rejects.toMatchObject({
        kind: 'invalid_payload',
      });
    });

    it('remains isolated and disabled', () => {
      expect(
        CALENDAR_CAPABILITIES.CREATE_CALENDAR_EVENT,
      ).toBe(false);

      expect(
        MicrosoftGraphCalendarEventError,
      ).toBeDefined();
    });
  },
);