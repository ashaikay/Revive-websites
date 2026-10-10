// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgrammeHubEmployer, ProgrammeHubProgramme } from '@/domain/programmeHub';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const programmeId = '33333333-3333-4333-8333-333333333333';
const secondProgrammeId = '33333333-3333-4333-8333-444444444444';
const searchId = '44444444-4444-4444-8444-444444444444';
const employerId = '55555555-5555-4555-8555-555555555555';
const candidate = {
  sourceIdentity: '12345678',
  name: 'MIDLAND BUILDERS LTD',
  sector: 'Construction',
  location: 'Birmingham, West Midlands',
  address: '1 Test Street, Birmingham, B1 1AA',
  sourceUrl: 'https://find-and-update.company-information.service.gov.uk/company/12345678',
  retrievedAt: '2026-10-10T00:00:00.000Z',
  evidence: [
    { kind: 'verified_fact', label: 'Companies House identity', value: 'MIDLAND BUILDERS LTD (12345678) is active.' },
    { kind: 'unknown', label: 'Vacancies and contacts', value: 'Companies House does not verify these details.' },
  ],
};
const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  invoke: vi.fn(),
  discoveryAvailable: true,
  outreachAvailable: false,
}));

vi.mock('@/data/supabaseClient', () => ({
  supabaseClient: {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        order: async () => ({
          data: (mocks.rows[table] ?? []).filter((row) => filters.every(([column, value]) => (row as Record<string, unknown>)[column] === value)),
          error: null,
        }),
      };
      return query;
    },
    functions: {
      invoke: (name: string, options: { body: Record<string, unknown> }) => mocks.invoke(name, options),
    },
  },
}));

import { ProgrammeEmployerEngagement } from '@/components/ProgrammeEmployerEngagement';

const programme = (id = programmeId): ProgrammeHubProgramme => ({
  id, workspaceId, name: id === programmeId ? 'West Midlands Employment Support' : 'Second Programme',
  timezone: 'Europe/London', brandingName: 'Programme Brand', senderDisplayName: 'Employment Team',
  senderReplyTo: 'team@example.test', active: true, version: 1,
});
const employer: ProgrammeHubEmployer = {
  id: employerId, workspaceId, programmeId, employerKey: 'CH-12345678', displayName: candidate.name,
  sectorKey: 'Construction', primaryGeographyKey: 'Birmingham', sourceProvider: 'companies_house',
  sourceIdentity: '12345678', sourceUrl: candidate.sourceUrl, sourceRetrievedAt: candidate.retrievedAt,
  sourceAddress: candidate.address, sourceEvidence: candidate.evidence, active: true, version: 1,
};
const emptyRows = () => {
  mocks.rows = {
    programme_hub_employer_discovery_searches: [],
    programme_hub_employers: [],
    programme_hub_outreach_settings: [],
    programme_hub_employer_engagements: [],
    programme_hub_employer_engagement_events: [],
    programme_hub_employer_outreach_drafts: [],
  };
};
const props = (selected = programme(), employers: ProgrammeHubEmployer[] = []) => ({
  workspaceId, userId, programme: selected, employers, contacts: [], advisers: [], members: [],
  isManager: true, canMaintain: true, onEmployersChanged: vi.fn(async () => {}),
});

beforeEach(() => {
  emptyRows();
  mocks.discoveryAvailable = true;
  mocks.outreachAvailable = false;
  mocks.invoke.mockReset().mockImplementation(async (name: string, { body }: { body: Record<string, unknown> }) => {
    if (name === 'rev-programme-employer-discovery' && body.action === 'status') return { data: { available: mocks.discoveryAvailable, provider: 'Companies House' }, error: null };
    if (name === 'rev-programme-employer-outreach-draft' && body.action === 'status') return { data: { available: mocks.outreachAvailable, model: mocks.outreachAvailable ? 'gpt-4.1-mini-2025-04-14' : null }, error: null };
    throw new Error(`Unexpected provider call: ${name}:${String(body.action ?? '')}`);
  });
  vi.stubGlobal('crypto', { randomUUID: () => searchId });
});
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('Programme Hub employer discovery and engagement', () => {
  it('shows editable pilot filters, separate postal sectors and disabled-provider setup without paid calls', async () => {
    mocks.discoveryAvailable = false;
    render(<ProgrammeEmployerEngagement {...props()} />);
    expect(await screen.findByRole('heading', { name: 'Find employers' })).toBeVisible();
    expect(screen.getByLabelText('Search geography')).toHaveValue('Birmingham / West Midlands');
    expect(screen.getByRole('checkbox', { name: 'Royal Mail and postal delivery' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Post Office branch roles' })).toBeChecked();
    expect(screen.getByLabelText(/Exclude employer-name terms/)).toHaveValue('barbering');
    expect(screen.getByText(/COMPANIES_HOUSE_API_KEY/)).toBeVisible();
    expect(screen.getByText(/OPENAI_API_KEY/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^send/i })).toBeNull();
    expect(mocks.invoke.mock.calls.filter(([name, options]) => name === 'rev-programme-employer-outreach-draft' && options.body.action === 'prepare')).toHaveLength(0);
  });

  it('reviews evidence and saves only the selected Companies House identity through the trusted boundary', async () => {
    mocks.invoke.mockImplementation(async (name: string, { body }: { body: Record<string, unknown> }) => {
      if (name === 'rev-programme-employer-discovery' && body.action === 'status') return { data: { available: true, provider: 'Companies House' }, error: null };
      if (name === 'rev-programme-employer-outreach-draft' && body.action === 'status') return { data: { available: false, model: null }, error: null };
      if (name === 'rev-programme-employer-discovery' && body.action === 'search') {
        mocks.rows.programme_hub_employer_discovery_searches = [{
          id: searchId, workspace_id: workspaceId, programme_id: programmeId, filters: body.filters,
          status: 'succeeded', results: [candidate], error_code: null, retrieved_at: candidate.retrievedAt, created_at: candidate.retrievedAt,
        }];
        return { data: { searchId, status: 'succeeded', results: [candidate], errorCode: null, retrievedAt: candidate.retrievedAt }, error: null };
      }
      if (name === 'rev-programme-employer-engagement-save') return { data: { operation: body.operation, recordId: employerId, workspaceId, programmeId, version: 1, duplicate: false }, error: null };
      throw new Error(`Unexpected call ${name}`);
    });
    render(<ProgrammeEmployerEngagement {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'SEARCH COMPANIES HOUSE' }));
    const result = await screen.findByRole('heading', { name: candidate.name });
    const card = result.closest('article');
    if (!card) throw new Error('Result card missing');
    expect(within(card).getByText(/Verified fact/)).toBeVisible();
    expect(within(card).getByText(/Unknown/)).toBeVisible();
    fireEvent.click(within(card).getByRole('button', { name: 'SAVE EMPLOYER TO PROGRAMME' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('rev-programme-employer-engagement-save', {
      body: expect.objectContaining({
        operation: 'discovery_employer', workspaceId, programmeId,
        payload: { searchId, sourceIdentity: candidate.sourceIdentity },
      }),
    }));
    expect(await screen.findByText(`${candidate.name} was saved to West Midlands Employment Support for review.`)).toBeVisible();
  });

  it('drops a late search response after programme switching', async () => {
    let resolveSearch!: (value: unknown) => void;
    const deferred = new Promise((resolve) => { resolveSearch = resolve; });
    mocks.invoke.mockImplementation(async (name: string, { body }: { body: Record<string, unknown> }) => {
      if (name === 'rev-programme-employer-discovery' && body.action === 'status') return { data: { available: true, provider: 'Companies House' }, error: null };
      if (name === 'rev-programme-employer-outreach-draft' && body.action === 'status') return { data: { available: false, model: null }, error: null };
      if (name === 'rev-programme-employer-discovery' && body.action === 'search') return deferred;
      throw new Error(`Unexpected call ${name}`);
    });
    const { rerender } = render(<ProgrammeEmployerEngagement {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'SEARCH COMPANIES HOUSE' }));
    rerender(<ProgrammeEmployerEngagement {...props(programme(secondProgrammeId))} />);
    resolveSearch({ data: { searchId, status: 'succeeded', results: [candidate], errorCode: null, retrievedAt: candidate.retrievedAt }, error: null });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Find employers' })).toBeVisible());
    expect(screen.queryByRole('heading', { name: candidate.name })).toBeNull();
    expect(screen.getByText(/No discovery results are ready for review/)).toBeVisible();
  });

  it('shows prepared-not-sent controls and keeps suppressed contacts unavailable', async () => {
    const contactId = '66666666-6666-4666-8666-666666666666';
    mocks.rows.programme_hub_outreach_settings = [{ id: '77777777-7777-4777-8777-777777777777', workspace_id: workspaceId, programme_id: programmeId, offer_summary: 'We provide practical recruitment support to local employers.', version: 1 }];
    mocks.outreachAvailable = true;
    render(<ProgrammeEmployerEngagement {...props(programme(), [employer])} contacts={[{
      id: contactId, workspaceId, programmeId, employerId, contactKey: 'CONTACT-1', preferredName: 'Suppressed Contact',
      roleTitle: null, businessEmail: 'contact@example.test', businessPhone: null, suppressed: true,
      suppressionReasonKey: 'do_not_contact', active: true, version: 1,
    }]} />);
    expect(await screen.findByText('Prepared — not sent')).toBeVisible();
    const outreach = screen.getByRole('heading', { name: 'Prepare employer outreach' }).closest('section');
    if (!outreach) throw new Error('Outreach section missing');
    expect(within(outreach).getByRole('option', { name: 'Suppressed Contact — suppressed' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^send/i })).toBeNull();
  });
});
