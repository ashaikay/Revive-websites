import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CALENDAR_CAPABILITIES } from '@/services/calendarAvailabilityService';
import {
  handleCalendarAvailability,
  MAXIMUM_AVAILABLE_SLOTS,
  type CalendarAvailabilityDependencies,
} from '../../supabase/functions/rev-calendar-availability/calendarAvailabilityBoundary';
import {
  CALENDAR_AVAILABILITY_ENVIRONMENT,
  createTrustedCalendarAvailabilityResolver,
} from '../../supabase/functions/rev-calendar-availability/trustedCalendarAvailabilityResolver';

const workspaceId = 'workspace-pilot';
const mailbox = 'calendar-pilot@internal.example';
const token = 'calendar-access-token';
const payload = {
  workspaceId,
  searchStartAt: '2026-09-24T09:00:00.000Z',
  searchEndAt: '2026-09-24T12:00:00.000Z',
  requestedDurationMinutes: 30,
  timezone: 'Europe/London',
};

function post(body: unknown): Request {
  return new Request('https://example.test/functions/v1/rev-calendar-availability', {
    method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function environment(values: Record<string, string | undefined> = {}) {
  const configured: Record<string, string | undefined> = {
    [CALENDAR_AVAILABILITY_ENVIRONMENT.authorizedWorkspaceId]: workspaceId,
    [CALENDAR_AVAILABILITY_ENVIRONMENT.primaryMailbox]: mailbox,
    MICROSOFT_GRAPH_TENANT_ID: 'tenant-id',
    MICROSOFT_GRAPH_CLIENT_ID: 'client-id',
    MICROSOFT_GRAPH_CLIENT_SECRET: 'client-secret',
    ...values,
  };
  return (name: string) => configured[name];
}

function configuredResolver(acquireAccessToken = vi.fn().mockResolvedValue({ accessToken: token, tokenType: 'Bearer', expiresIn: 3600 })) {
  return {
    resolver: createTrustedCalendarAvailabilityResolver({ getEnvironment: environment(), acquireAccessToken }),
    acquireAccessToken,
  };
}

function dependencies(resolver: CalendarAvailabilityDependencies['resolveTrustedCalendarAvailability'], graph = vi.fn().mockResolvedValue([]), enabled = false): CalendarAvailabilityDependencies {
  return {
    isCalendarAvailabilityEnabled: () => enabled,
    getAuthenticatedUserId: vi.fn().mockResolvedValue('user-1'),
    hasActiveWorkspaceMembership: vi.fn().mockResolvedValue(true),
    resolveTrustedCalendarAvailability: resolver,
    readBusyIntervals: graph,
    now: () => '2026-09-24T08:00:00.000Z',
  };
}

describe('Phase 5E controlled calendar availability-read preparation', () => {
  it('keeps production disabled before resolver, Graph authentication, or Graph access', async () => {
    const { resolver, acquireAccessToken } = configuredResolver();
    const resolveTrustedCalendarAvailability = vi.fn(resolver);
    const graph = vi.fn();
    const deps = dependencies(resolveTrustedCalendarAvailability, graph);
    const response = await handleCalendarAvailability(post(payload), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'disabled', providerCalls: 0, externalEffect: 'none' });
    expect(resolveTrustedCalendarAvailability).not.toHaveBeenCalled();
    expect(acquireAccessToken).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
    expect(CALENDAR_CAPABILITIES.READ_CALENDAR_AVAILABILITY).toBe(false);
    expect(CALENDAR_CAPABILITIES.CREATE_CALENDAR_EVENT).toBe(false);
  });

  it('fails closed for missing trusted configuration or configured-workspace mismatch on the injected enabled path', async () => {
    const acquireAccessToken = vi.fn();
    const missingResolver = createTrustedCalendarAvailabilityResolver({
      getEnvironment: environment({ [CALENDAR_AVAILABILITY_ENVIRONMENT.primaryMailbox]: '' }),
      acquireAccessToken,
    });
    const graph = vi.fn();
    expect((await handleCalendarAvailability(post(payload), dependencies(missingResolver, graph, true))).status).toBe(503);
    expect(acquireAccessToken).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();

    const { resolver, acquireAccessToken: configuredAuth } = configuredResolver();
    expect((await handleCalendarAvailability(post({ ...payload, workspaceId: 'another-workspace' }), dependencies(resolver, graph, true))).status).toBe(403);
    expect(configuredAuth).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
  });

  it('does not allow browser input to override the trusted mailbox or calendar identity', async () => {
    const { resolver, acquireAccessToken } = configuredResolver();
    const graph = vi.fn();
    const response = await handleCalendarAvailability(post({ ...payload, mailboxUserPrincipalName: 'other@example.com', selectedCalendarId: 'other-calendar' }), dependencies(resolver, graph, true));
    expect(response.status).toBe(400);
    expect(acquireAccessToken).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
  });

  it('uses the existing app-only authentication only server-side and passes one trusted mailbox to the adapter', async () => {
    const { resolver, acquireAccessToken } = configuredResolver();
    const graph = vi.fn().mockResolvedValue([{ startAt: '2026-09-24T09:00:00.000Z', endAt: '2026-09-24T10:00:00.000Z' }]);
    const response = await handleCalendarAvailability(post(payload), dependencies(resolver, graph, true));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(acquireAccessToken).toHaveBeenCalledWith({ tenantId: 'tenant-id', clientId: 'client-id', clientSecret: 'client-secret' });
    expect(graph).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: token,
      mailboxUserPrincipalName: mailbox,
      selectedCalendar: expect.objectContaining({ providerCalendarReference: mailbox }),
    }));
    expect(body).not.toContain(token);
    expect(body).not.toContain(mailbox);
    expect(JSON.parse(body).slots[0]).toEqual({
      workspaceId, selectedCalendarId: 'configured-primary-calendar', startAt: '2026-09-24T10:00:00.000Z', endAt: '2026-09-24T10:30:00.000Z',
    });
  });

  it('enforces a bounded query range and deterministic slot limit before excessive provider work', async () => {
    const { resolver } = configuredResolver();
    const graph = vi.fn().mockResolvedValue([]);
    const tooLong = await handleCalendarAvailability(post({ ...payload, searchEndAt: '2026-10-02T09:00:00.000Z' }), dependencies(resolver, graph, true));
    expect(tooLong.status).toBe(400);
    expect(graph).not.toHaveBeenCalled();

    const response = await handleCalendarAvailability(post({
      ...payload, searchStartAt: '2026-09-24T00:00:00.000Z', searchEndAt: '2026-09-25T00:00:00.000Z', requestedDurationMinutes: 1,
    }), dependencies(resolver, graph, true));
    expect(response.status).toBe(200);
    expect((await response.json()).slots).toHaveLength(MAXIMUM_AVAILABLE_SLOTS);
  });

  it('returns safe failures and contains no event mutation or Calendars.ReadWrite reference', async () => {
    const source = [
      '../../supabase/functions/rev-calendar-availability/calendarAvailabilityBoundary.ts',
      '../../supabase/functions/rev-calendar-availability/trustedCalendarAvailabilityResolver.ts',
      '../../supabase/functions/rev-calendar-availability/index.ts',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
    const response = await handleCalendarAvailability(post(payload), dependencies(vi.fn().mockRejectedValue(new Error(`${token} ${mailbox} raw-provider-payload stack`)), vi.fn(), true));
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).not.toMatch(new RegExp(`${token}|${mailbox}|raw-provider-payload|stack`));
    expect(source).not.toMatch(/Calendars\.ReadWrite|\/events|createEvent|updateEvent|deleteEvent|send|accept|decline|\.patch\(|\.delete\(/i);
  });
});