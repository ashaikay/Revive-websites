// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const adviserId = '33333333-3333-4333-8333-333333333333';
const programmeId = '44444444-4444-4444-8444-444444444444';
const secondProgrammeId = '44444444-4444-4444-8444-555555555555';
const participantId = '55555555-5555-4555-8555-555555555555';
const secondParticipantId = '55555555-5555-4555-8555-666666666666';
const savedId = '66666666-6666-4666-8666-666666666666';

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  invoke: vi.fn(),
  discoveryStatus: vi.fn(),
  outreachStatus: vi.fn(),
}));

vi.mock('@/data/supabaseClient', () => ({
  supabaseClient: {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const result = () => ({
        data: (mocks.rows[table] ?? []).filter((row) => filters.every(([column, value]) => (row as Record<string, unknown>)[column] === value)),
        error: null,
      });
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        order: async () => result(),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      };
      return query;
    },
    functions: { invoke: (name: string, options: { body?: Record<string, unknown> } = {}) => {
      if (name === 'rev-programme-employer-discovery') {
        if (options.body?.action !== 'status') throw new Error('Unexpected employer discovery provider call');
        return mocks.discoveryStatus(name, options);
      }
      if (name === 'rev-programme-employer-outreach-draft') {
        if (options.body?.action !== 'status') throw new Error('Unexpected employer outreach provider call');
        return mocks.outreachStatus(name, options);
      }
      return mocks.invoke(name, options);
    } },
  },
}));

import { ProgrammeHubModule } from '@/components/ProgrammeHubModule';

const programmeRow = {
  id: programmeId,
  workspace_id: workspaceId,
  name: 'Employment Support',
  timezone: 'Europe/London',
  branding_name: null,
  sender_display_name: null,
  sender_reply_to: null,
  active: true,
  version: 1,
};
const participantRow = {
  id: participantId,
  workspace_id: workspaceId,
  programme_id: programmeId,
  participant_key: 'participant-001',
  preferred_name: 'Alex',
  case_reference: 'CASE-001',
  desired_role_keys: ['retail'],
  skill_keys: ['customer_service'],
  vacancy_search_geography_keys: ['configured-area'],
  residency_evidence_reference: null,
  active: true,
  version: 1,
};
const secondProgrammeRow = {
  ...programmeRow,
  id: secondProgrammeId,
  name: 'Youth Employment',
};
const secondParticipantRow = {
  ...participantRow,
  id: secondParticipantId,
  programme_id: secondProgrammeId,
  participant_key: 'participant-002',
  preferred_name: 'Sam',
  case_reference: 'CASE-002',
};
const setRows = (role: 'owner' | 'member', includeParticipant = false) => {
  mocks.rows = {
    programme_hub_programmes: [programmeRow],
    programme_hub_advisers: role === 'member' ? [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, user_id: adviserId, active: true, version: 1 }] : [],
    programme_hub_employers: [],
    programme_hub_employer_contacts: [],
    programme_hub_vacancies: [],
    programme_hub_participants: includeParticipant ? [participantRow] : [],
    programme_hub_participant_advisers: includeParticipant ? [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, adviser_user_id: adviserId, active: true, version: 1 }] : [],
    programme_hub_participant_notes: [],
    programme_hub_employer_discovery_searches: [],
    programme_hub_outreach_settings: [],
    programme_hub_employer_engagements: [],
    programme_hub_employer_engagement_events: [],
    programme_hub_employer_outreach_drafts: [],
    programme_hub_contracts: [],
    workspace_members: [{ workspace_id: workspaceId, user_id: role === 'owner' ? ownerId : adviserId, role, status: 'active' }],
  };
};

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.invoke.mockReset();
  mocks.discoveryStatus.mockReset().mockResolvedValue({ data: { available: false, provider: 'Companies House' }, error: null });
  mocks.outreachStatus.mockReset().mockResolvedValue({ data: { available: false, model: null }, error: null });
  vi.stubGlobal('crypto', { randomUUID: () => '77777777-7777-4777-8777-777777777777' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Outcomes / Programme Hub employer foundation', () => {
  it('shows separate tenant configuration gaps as Needs review and offers all manual record forms to owners', async () => {
    setRows('owner');
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    expect(await screen.findByRole('heading', { name: 'Employer Engagement' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Programme readiness' })).toHaveTextContent('Needs review');
    expect(screen.getByRole('region', { name: 'Programme readiness' })).toHaveTextContent('residency eligibility');
    expect(screen.getByRole('region', { name: 'Programme readiness' })).toHaveTextContent('outcome vocabulary');
    expect(screen.getByRole('region', { name: 'Programme readiness' })).toHaveTextContent('spreadsheet mapping');
    expect(screen.getByText(/Matching postcode areas never prove participant residency/)).toBeVisible();
    for (const heading of ['Overview and setup', 'Employment Specialists and caseload', 'Employers and contacts', 'Employers', 'Employer contacts', 'Job opportunities', 'Service users']) {
      expect(screen.getByRole('heading', { name: heading })).toBeVisible();
    }
    expect(screen.queryByText(/revenue/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /send/i })).toBeNull();
  });

  it('submits a tenant-neutral employer through the trusted versioned boundary', async () => {
    setRows('owner');
    mocks.invoke.mockImplementation(async (_name: string, { body }: { body: Record<string, unknown> }) => ({
      data: { operation: body.operation, recordId: savedId, workspaceId, programmeId, version: 1 },
      error: null,
    }));
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const section = (await screen.findByRole('heading', { name: 'Employers' })).closest('section');
    if (!section) throw new Error('Employer section missing');
    fireEvent.change(within(section).getByLabelText('Employer reference (for example, EMP-001)'), { target: { value: 'EMP-001' } });
    fireEvent.change(within(section).getByLabelText('Employer name'), { target: { value: 'Tenant Neutral Employer' } });
    fireEvent.change(within(section).getByLabelText('Sector (for example, retail)'), { target: { value: 'tenant-sector' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Add record' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    const [functionName, options] = mocks.invoke.mock.calls[0];
    expect(functionName).toBe('rev-programme-hub-save');
    expect(options.body).toMatchObject({
      operation: 'employer',
      workspaceId,
      programmeId,
      recordId: null,
      expectedVersion: 0,
      payload: {
        employerKey: 'EMP-001',
        displayName: 'Tenant Neutral Employer',
        sectorKey: 'tenant-sector',
        primaryGeographyKey: '',
        active: true,
      },
    });
    expect(await screen.findByText('Employer created.')).toBeVisible();
    expect(window.sessionStorage.getItem(`rev-programme-hub-save:${workspaceId}:${ownerId}`)).toBeNull();
  });

  it('retains an unconfirmed save and blocks a different change until exact retry', async () => {
    setRows('owner');
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('network unavailable') });
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const section = (await screen.findByRole('heading', { name: 'Employers' })).closest('section');
    if (!section) throw new Error('Employer section missing');
    fireEvent.change(within(section).getByLabelText('Employer reference (for example, EMP-001)'), { target: { value: 'EMP-002' } });
    fireEvent.change(within(section).getByLabelText('Employer name'), { target: { value: 'Unconfirmed Employer' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Add record' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Save not confirmed');
    expect(screen.getByRole('button', { name: 'Retry same change' })).toBeVisible();
    expect(within(section).getByRole('button', { name: 'Add record' })).toBeDisabled();
    const retained = JSON.parse(window.sessionStorage.getItem(`rev-programme-hub-save:${workspaceId}:${ownerId}`) ?? 'null');
    expect(retained).toMatchObject({ operation: 'employer', payload: { employerKey: 'EMP-002', displayName: 'Unconfirmed Employer' } });
  });

  it('restricts an adviser view to assigned participants returned by caseload RLS', async () => {
    setRows('member', true);
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={adviserId} />);
    expect(await screen.findByRole('heading', { name: 'My assigned Service users' })).toBeVisible();
    expect(screen.getByText(/Alex/)).toBeVisible();
    expect(screen.getByText(/CASE-001/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Advisers and caseload' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Participant employment profiles' })).toBeNull();
    expect(screen.getByText(/Needs review - residency evidence is missing/)).toBeVisible();
  });

  it('switches programmes without showing stale participant records or drafts', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    mocks.rows.programme_hub_participants = [participantRow, secondParticipantRow];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    expect(await screen.findByText('Alex')).toBeVisible();
    expect(screen.queryByText('Sam')).toBeNull();
    fireEvent.change(screen.getByLabelText('Participant reference (for example, PART-001)'), { target: { value: 'DRAFT-OLD' } });
    fireEvent.change(screen.getByLabelText('Choose a programme'), { target: { value: secondProgrammeId } });
    expect(await screen.findByText(/You are viewing/)).toHaveTextContent('Youth Employment');
    expect(screen.getByText('Sam')).toBeVisible();
    expect(screen.queryByText('Alex')).toBeNull();
    expect(screen.getByLabelText('Participant reference (for example, PART-001)')).toHaveValue('');
  });

  it('shows programme-scoped notes newest first with server author and programme time', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_participant_notes = [
      { id: '88888888-8888-4888-8888-888888888888', workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, body: 'Older action', author_user_id: ownerId, created_at: '2026-10-09T08:00:00.000Z', version: 1 },
      { id: '99999999-9999-4999-8999-999999999999', workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, body: 'Newest action', author_user_id: ownerId, created_at: '2026-10-09T09:00:00.000Z', version: 1 },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workspace_id: workspaceId, programme_id: secondProgrammeId, participant_id: secondParticipantId, body: 'Other programme note', author_user_id: ownerId, created_at: '2026-10-09T10:00:00.000Z', version: 1 },
    ];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    expect(await screen.findByText('Newest action')).toBeVisible();
    const timeline = screen.getByText('Newest action').closest('ol');
    if (!timeline) throw new Error('Note timeline missing');
    const notes = within(timeline).getAllByRole('listitem');
    expect(notes[0]).toHaveTextContent('Newest action');
    expect(notes[1]).toHaveTextContent('Older action');
    expect(notes[0]).toHaveTextContent('You');
    expect(notes[0]).toHaveTextContent('BST');
    expect(screen.queryByText('Other programme note')).toBeNull();
    expect(screen.getByText(/Avoid diagnoses and unnecessary sensitive details/)).toBeVisible();
  });

  it('retains the exact participant note request after an uncertain save', async () => {
    setRows('owner', true);
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('network unavailable') });
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const note = await screen.findByLabelText('Add a note');
    fireEvent.change(note, { target: { value: '  Agreed to update the CV this week.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save not confirmed');
    const retained = JSON.parse(window.sessionStorage.getItem(`rev-programme-hub-save:${workspaceId}:${ownerId}`) ?? 'null');
    expect(retained).toMatchObject({
      operation: 'participant_note',
      programmeId,
      recordId: null,
      expectedVersion: 0,
      payload: { participantId, body: 'Agreed to update the CV this week.' },
    });
    const originalRequest = mocks.invoke.mock.calls[0][1].body;
    mocks.invoke.mockResolvedValueOnce({
      data: { operation: 'participant_note', recordId: savedId, workspaceId, programmeId, version: 1 },
      error: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry same change' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls[1][1].body).toEqual(originalRequest);
    expect(await screen.findByText('The retained Programme Hub change was confirmed.')).toBeVisible();
    expect(window.sessionStorage.getItem(`rev-programme-hub-save:${workspaceId}:${ownerId}`)).toBeNull();
  });
});
