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
  notesReadFails: false,
  contactReadFails: false,
  selections: {} as Record<string, string>,
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
        error: (mocks.notesReadFails && table === 'programme_hub_participant_notes') || (mocks.contactReadFails && table === 'programme_hub_participant_contacts') ? new Error('read unavailable') : null,
      });
      const query = {
        select: (columns: string) => { mocks.selections[table] = columns; return query; },
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
    programme_hub_participant_contacts: [],
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
  window.localStorage.clear();
  mocks.notesReadFails = false;
  mocks.contactReadFails = false;
  mocks.selections = {};
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
  it('keeps unavailable configuration in collapsed manager settings and offers everyday record forms', async () => {
    setRows('owner');
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    expect(await screen.findByRole('heading', { name: 'Employer Engagement' })).toBeVisible();
    const settings = screen.getByText('Programme settings').closest('details');
    if (!settings) throw new Error('Programme settings disclosure missing');
    expect(settings).not.toHaveAttribute('open');
    expect(within(settings).getByText(/not available in this interface/)).toHaveTextContent('residency eligibility');
    expect(within(settings).getByText(/not available in this interface/)).toHaveTextContent('outcome vocabulary');
    expect(within(settings).getByText(/not available in this interface/)).toHaveTextContent('spreadsheet mapping');
    expect(screen.queryByText('Needs review')).toBeNull();
    for (const heading of ['Employment Specialists and caseload', 'Employers and contacts', 'Employers', 'Employer contacts', 'Job opportunities', 'Service users']) {
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
    expect(await within(section).findByText('Employer created.')).toBeVisible();
    expect(window.sessionStorage.getItem(`rev-programme-hub-save:${workspaceId}:${ownerId}`)).toBeNull();
  });

  it('shows persistent validation and keeps entered contact fields when required data is missing', async () => {
    setRows('owner');
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const section = (await screen.findByRole('heading', { name: 'Employer contacts' })).closest('section');
    if (!section) throw new Error('Employer contact section missing');
    const contactName = within(section).getByLabelText('Preferred name');
    fireEvent.change(contactName, { target: { value: 'Taylor Contact' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Add record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter an employer before saving.');
    expect(contactName).toHaveValue('Taylor Contact');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('prevents duplicate submissions while a trusted save is pending', async () => {
    setRows('owner');
    let resolveSave!: (value: unknown) => void;
    mocks.invoke.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const section = (await screen.findByRole('heading', { name: 'Employers' })).closest('section');
    if (!section) throw new Error('Employer section missing');
    fireEvent.change(within(section).getByLabelText('Employer reference (for example, EMP-001)'), { target: { value: 'EMP-003' } });
    fireEvent.change(within(section).getByLabelText('Employer name'), { target: { value: 'Single Save Employer' } });
    const add = within(section).getByRole('button', { name: 'Add record' });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(await within(section).findByText('Saving this Programme Hub change. Please wait.')).toBeVisible();
    expect(within(section).getByRole('button', { name: 'Saving...' })).toBeDisabled();
    resolveSave({ data: { operation: 'employer', recordId: savedId, workspaceId, programmeId, version: 1 }, error: null });
    expect(await within(section).findByText('Employer created.')).toBeVisible();
  });

  it('shows an unknown save outcome and preserves the submitted form values', async () => {
    setRows('owner');
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('denied') });
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const section = (await screen.findByRole('heading', { name: 'Employers' })).closest('section');
    if (!section) throw new Error('Employer section missing');
    const reference = within(section).getByLabelText('Employer reference (for example, EMP-001)');
    const name = within(section).getByLabelText('Employer name');
    fireEvent.change(reference, { target: { value: 'EMP-DENIED' } });
    fireEvent.change(name, { target: { value: 'Denied Employer' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Add record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save outcome is unknown');
    expect(reference).toHaveValue('EMP-DENIED');
    expect(name).toHaveValue('Denied Employer');
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
    expect(alert).toHaveTextContent('Save outcome is unknown');
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
    expect(screen.getByText('Case reference: CASE-001')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Advisers and caseload' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Participant employment profiles' })).toBeNull();
    expect(screen.queryByText('Programme settings')).toBeNull();
    expect(screen.getByText(/Needs review - residency evidence is missing/)).toBeVisible();
  });

  it('creates an authorised caseload assignment only for an active programme adviser', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_advisers = [{
      id: savedId, workspace_id: workspaceId, programme_id: programmeId, user_id: ownerId, active: true, version: 1,
    }];
    mocks.invoke.mockImplementation(async (_name: string, { body }: { body: Record<string, unknown> }) => ({
      data: { operation: body.operation, recordId: savedId, workspaceId, programmeId, version: 1 },
      error: null,
    }));
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.change(await screen.findByLabelText('Service user for caseload'), { target: { value: participantId } });
    fireEvent.change(screen.getByLabelText('Employment Specialist for caseload'), { target: { value: ownerId } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign ES' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.invoke.mock.calls[0][1].body).toMatchObject({
      operation: 'participant_adviser',
      programmeId,
      recordId: null,
      expectedVersion: 0,
      payload: { participantId, adviserUserId: ownerId, active: true },
    });
    expect(await screen.findByText('Assigned.')).toBeVisible();
  });

  it('explains when no active programme adviser registration exists', async () => {
    setRows('owner', true);
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    expect(await screen.findByText(/Add an Employment Specialist under Manage team first/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Assign ES' })).toBeDisabled();
  });

  it('reactivates an inactive assignment with its loaded version and treats stale rejection as definitive', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_advisers = [{
      id: savedId, workspace_id: workspaceId, programme_id: programmeId, user_id: ownerId, active: true, version: 1,
    }];
    const assignmentId = '88888888-8888-4888-8888-888888888888';
    mocks.rows.programme_hub_participant_advisers = [{
      id: assignmentId, workspace_id: workspaceId, programme_id: programmeId,
      participant_id: participantId, adviser_user_id: ownerId, active: false, version: 3,
    }];
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: new Response(JSON.stringify({
        error: 'Programme record could not be saved.',
        errorCode: 'caseload_assignment_changed',
      }), { status: 409, headers: { 'Content-Type': 'application/json' } }) },
    });
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.change(await screen.findByLabelText('Service user for caseload'), { target: { value: participantId } });
    fireEvent.change(screen.getByLabelText('Employment Specialist for caseload'), { target: { value: ownerId } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore assignment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed after it was loaded');
    expect(mocks.invoke.mock.calls[0][1].body).toMatchObject({
      operation: 'participant_adviser',
      recordId: assignmentId,
      expectedVersion: 3,
    });
    expect(screen.queryByRole('button', { name: 'Retry same change' })).toBeNull();
    expect(window.sessionStorage.getItem(`rev-programme-hub-save:${workspaceId}:${ownerId}`)).toBeNull();
    expect(screen.getByLabelText('Service user for caseload')).toHaveValue(participantId);
    expect(screen.getByLabelText('Employment Specialist for caseload')).toHaveValue(ownerId);
  });

  it('does not offer a retry for a definitive caseload permission denial', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_advisers = [{
      id: savedId, workspace_id: workspaceId, programme_id: programmeId, user_id: ownerId, active: true, version: 1,
    }];
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: new Response(JSON.stringify({
        error: 'Programme record could not be saved.',
        errorCode: 'workspace_access_denied',
      }), { status: 403, headers: { 'Content-Type': 'application/json' } }) },
    });
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.change(await screen.findByLabelText('Service user for caseload'), { target: { value: participantId } });
    fireEvent.change(screen.getByLabelText('Employment Specialist for caseload'), { target: { value: ownerId } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign ES' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not have permission');
    expect(screen.queryByRole('button', { name: 'Retry same change' })).toBeNull();
    expect(window.sessionStorage.getItem(`rev-programme-hub-save:${workspaceId}:${ownerId}`)).toBeNull();
  });

  it('retains the exact caseload request when the outcome is genuinely uncertain', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_advisers = [{
      id: savedId, workspace_id: workspaceId, programme_id: programmeId, user_id: ownerId, active: true, version: 1,
    }];
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('network unavailable') });
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.change(await screen.findByLabelText('Service user for caseload'), { target: { value: participantId } });
    fireEvent.change(screen.getByLabelText('Employment Specialist for caseload'), { target: { value: ownerId } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign ES' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outcome is unknown');
    const original = mocks.invoke.mock.calls[0][1].body;
    mocks.invoke.mockResolvedValueOnce({
      data: { operation: 'participant_adviser', recordId: savedId, workspaceId, programmeId, version: 1 },
      error: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry same change' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls[1][1].body).toEqual(original);
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

  it('restores only the selected programme ID after refresh for the same workspace and user', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    mocks.rows.programme_hub_participants = [participantRow, secondParticipantRow];
    const first = render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.change(await screen.findByLabelText('Choose a programme'), { target: { value: secondProgrammeId } });
    expect(await screen.findByText(/You are viewing/)).toHaveTextContent('Youth Employment');
    expect(window.localStorage.getItem(`rev-programme-hub-selection:${workspaceId}:${ownerId}`)).toBe(secondProgrammeId);
    expect(window.localStorage.length).toBe(1);
    first.unmount();

    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    expect(await screen.findByLabelText('Choose a programme')).toHaveValue(secondProgrammeId);
    expect(screen.getByText('Sam')).toBeVisible();
    expect(screen.queryByText('Alex')).toBeNull();
  });

  it('does not reuse a programme preference after the signed-in user changes', async () => {
    const secondUserId = '22222222-2222-4222-8222-333333333333';
    setRows('owner', true);
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    mocks.rows.programme_hub_participants = [participantRow, secondParticipantRow];
    window.localStorage.setItem(`rev-programme-hub-selection:${workspaceId}:${ownerId}`, secondProgrammeId);
    mocks.rows.workspace_members = [{ workspace_id: workspaceId, user_id: secondUserId, role: 'owner', status: 'active' }];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={secondUserId} />);
    expect(await screen.findByLabelText('Choose a programme')).toHaveValue(programmeId);
    expect(screen.getByText('Alex')).toBeVisible();
    expect(screen.queryByText('Sam')).toBeNull();
    expect(window.localStorage.getItem(`rev-programme-hub-selection:${workspaceId}:${secondUserId}`)).toBe(programmeId);
  });

  it('does not reuse a programme preference after the workspace changes', async () => {
    const secondWorkspaceId = '11111111-1111-4111-8111-222222222222';
    setRows('owner', true);
    window.localStorage.setItem(`rev-programme-hub-selection:${workspaceId}:${ownerId}`, secondProgrammeId);
    mocks.rows = Object.fromEntries(Object.entries(mocks.rows).map(([table, rows]) => [
      table,
      rows.map((row) => ({ ...row as Record<string, unknown>, workspace_id: secondWorkspaceId })),
    ]));
    render(<ProgrammeHubModule workspaceId={secondWorkspaceId} userId={ownerId} />);
    expect(await screen.findByLabelText('Choose a programme')).toHaveValue(programmeId);
    expect(window.localStorage.getItem(`rev-programme-hub-selection:${secondWorkspaceId}:${ownerId}`)).toBe(programmeId);
    expect(window.localStorage.getItem(`rev-programme-hub-selection:${workspaceId}:${ownerId}`)).toBe(secondProgrammeId);
  });

  it('falls back safely when access to the stored programme has been revoked', async () => {
    setRows('owner', true);
    window.localStorage.setItem(`rev-programme-hub-selection:${workspaceId}:${ownerId}`, secondProgrammeId);
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    expect(await screen.findByLabelText('Choose a programme')).toHaveValue(programmeId);
    expect(screen.getByText('Alex')).toBeVisible();
    expect(screen.queryByText('Sam')).toBeNull();
    expect(window.localStorage.getItem(`rev-programme-hub-selection:${workspaceId}:${ownerId}`)).toBe(programmeId);
  });

  it('shows programme-scoped notes newest first with server author and programme time', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_participant_notes = [
      { id: '88888888-8888-4888-8888-888888888888', workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, body: 'Older action', author_user_id: ownerId, created_at: '2026-10-09T08:00:00.000Z', version: 1 },
      { id: '99999999-9999-4999-8999-999999999999', workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, body: 'Newest action', author_user_id: ownerId, created_at: '2026-10-09T09:00:00.000Z', version: 1 },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workspace_id: workspaceId, programme_id: secondProgrammeId, participant_id: secondParticipantId, body: 'Other programme note', author_user_id: ownerId, created_at: '2026-10-09T10:00:00.000Z', version: 1 },
    ];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const summary = await screen.findByText(/^Case notes \(2\)/);
    fireEvent.click(summary);
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
    fireEvent.click(await screen.findByText(/^Case notes \(0\)/));
    const note = await screen.findByLabelText('Add a note');
    fireEvent.change(note, { target: { value: '  Agreed to update the CV this week.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save outcome is unknown');
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
  it('shows authorised saved contact, opportunity and profile fields without entering edit mode', async () => {
    setRows('owner', true);
    const employerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const contactId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    mocks.rows.programme_hub_employers = [{ id: employerId, workspace_id: workspaceId, programme_id: programmeId, employer_key: 'EMP-READ', display_name: 'Read Only Employer', sector_key: 'hospitality', primary_geography_key: 'Birmingham', active: true, version: 1 }];
    mocks.rows.programme_hub_employer_contacts = [{ id: contactId, workspace_id: workspaceId, programme_id: programmeId, employer_id: employerId, contact_key: 'CONTACT-READ', preferred_name: 'Taylor', role_title: 'Hiring manager', business_email: 'taylor@example.org', business_phone: null, suppressed: false, suppression_reason_key: null, active: true, version: 1 }];
    mocks.rows.programme_hub_vacancies = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, employer_id: employerId, employer_contact_id: contactId, vacancy_key: 'VAC-READ', title: 'Chef opportunity', work_geography_key: 'Birmingham', required_skill_keys: ['food_safety'], desired_skill_keys: ['teamwork'], active: true, version: 1 }];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const contact = (await screen.findByRole('heading', { name: 'Taylor' })).closest('article')!;
    fireEvent.click(within(contact).getByText('View details'));
    expect(within(contact).getByText('taylor@example.org')).toBeVisible();
    expect(within(contact).getByText('Hiring manager')).toBeVisible();
    expect(within(contact).getByText('Not provided')).toBeVisible();
    const opportunity = screen.getByRole('heading', { name: 'Chef opportunity' }).closest('article')!;
    fireEvent.click(within(opportunity).getByText('View details'));
    expect(within(opportunity).getByText('food_safety')).toBeVisible();
    expect(within(opportunity).getByText('teamwork')).toBeVisible();
    const participant = screen.getByRole('heading', { name: 'Alex' }).closest('article')!;
    fireEvent.click(within(participant).getByText('View employment profile'));
    expect(within(participant).getByText('customer_service')).toBeVisible();
    expect(within(participant).getByText('configured-area')).toBeVisible();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('keeps case notes independently collapsed and preserves an open unsaved draft', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_participants = [participantRow, { ...secondParticipantRow, programme_id: programmeId }];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const alex = (await screen.findByRole('heading', { name: 'Alex' })).closest('article')!;
    const sam = screen.getByRole('heading', { name: 'Sam' }).closest('article')!;
    const alexSummary = within(alex).getByText(/^Case notes/);
    const samSummary = within(sam).getByText(/^Case notes/);
    expect(alexSummary.closest('details')).not.toHaveAttribute('open');
    expect(samSummary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(alexSummary);
    fireEvent.change(within(alex).getByLabelText('Add a note'), { target: { value: 'Keep my draft' } });
    fireEvent.click(alexSummary);
    await waitFor(() => expect(alexSummary.closest('details')).toHaveAttribute('open'));
    expect(within(alex).getByLabelText('Add a note')).toHaveValue('Keep my draft');
    expect(samSummary.closest('details')).not.toHaveAttribute('open');
  });

  it('shows contact validation beside its save action rather than at the top of the page', async () => {
    setRows('owner');
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const section = (await screen.findByRole('heading', { name: 'Employer contacts' })).closest('section')!;
    fireEvent.click(within(section).getByRole('button', { name: 'Add record' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Enter an employer');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['Employers', 'employer', [['Employer reference (for example, EMP-001)', 'EMP-SAVE'], ['Employer name', 'Local employer']], 'Employer created.'],
    ['Employer contacts', 'contact', [['Employer', savedId], ['Contact reference (for example, CONTACT-001)', 'CONTACT-SAVE'], ['Preferred name', 'Taylor']], 'Employer contact created.'],
    ['Job opportunities', 'vacancy', [['Employer', savedId], ['Vacancy reference (for example, VAC-001)', 'VAC-SAVE'], ['Vacancy title', 'Local opportunity']], 'Vacancy created.'],
    ['Service users', 'participant', [['Participant reference (for example, PART-001)', 'PART-SAVE'], ['Preferred name', 'Robin'], ['Tenant case reference', 'CASE-SAVE']], 'Participant employment profile created.'],
  ])('shows progress and confirmation beside the %s form', async (heading, operation, values, confirmation) => {
    setRows('owner');
    mocks.rows.programme_hub_employers = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, employer_key: 'EMP-EXISTING', display_name: 'Existing employer', sector_key: null, primary_geography_key: null, active: true, version: 1 }];
    let resolveSave!: (value: unknown) => void;
    mocks.invoke.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const section = (await screen.findByRole('heading', { name: heading })).closest('section')!;
    const form = within(section).getByRole('button', { name: 'Add record' }).closest('form')!;
    for (const [label, value] of values as string[][]) fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add record' }));
    expect(await within(form).findByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(mocks.invoke.mock.calls[0][1].body.operation).toBe(operation);
    resolveSave({ data: { operation, recordId: savedId, workspaceId, programmeId, version: 1 }, error: null });
    expect(await within(form).findByText(confirmation)).toBeVisible();
    expect(screen.getAllByText(confirmation)).toHaveLength(1);
  });

  it('shows programme and adviser registration progress at their own controls', async () => {
    setRows('owner');
    let resolveSave!: (value: unknown) => void;
    mocks.invoke.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.click(await screen.findByText('Programme configuration'));
    const configuration = screen.getByText('Programme configuration').closest('details')!;
    fireEvent.change(within(configuration).getByLabelText('Programme name'), { target: { value: 'New programme' } });
    fireEvent.click(within(configuration).getByRole('button', { name: 'Create programme' }));
    expect(await within(configuration).findByRole('button', { name: 'Saving...' })).toBeDisabled();
    resolveSave({ data: { operation: 'programme', recordId: savedId, workspaceId, programmeId, version: 1 }, error: null });
    expect(await within(configuration).findByText('Programme created.')).toBeVisible();
    fireEvent.click(screen.getByText(/^Manage team/));
    fireEvent.change(screen.getByLabelText('Organisation member to add as Employment Specialist'), { target: { value: ownerId } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Employment Specialist' }));
    const caseload = screen.getByRole('heading', { name: 'Employment Specialists and caseload' }).closest('section')!;
    expect(await within(caseload).findByRole('button', { name: 'Saving...' })).toBeDisabled();
    resolveSave({ data: { operation: 'adviser', recordId: savedId, workspaceId, programmeId, version: 1 }, error: null });
    expect(await within(caseload).findByText('Employment Specialist added.')).toBeVisible();
  });

  it('does not show a failed notes read as an empty timeline', async () => {
    setRows('owner', true);
    mocks.notesReadFails = true;
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const summary = await screen.findByText(/^Case notes \(could not load\)/);
    fireEvent.click(summary);
    expect(screen.getByText(/Case notes could not be loaded/)).toBeVisible();
    expect(screen.queryByText(/No notes have been added/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled();
  });

  it('shows all active ES connections with server dates in the programme timezone', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_advisers = [ownerId, adviserId].map((id, index) => ({ id: index === 0 ? savedId : participantId, workspace_id: workspaceId, programme_id: programmeId, user_id: id, active: true, version: 1 }));
    mocks.rows.workspace_members.push({ workspace_id: workspaceId, user_id: adviserId, role: 'member', status: 'active' });
    mocks.rows.programme_hub_participant_advisers = [ownerId, adviserId].map((id, index) => ({ id: index === 0 ? savedId : participantId, workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, adviser_user_id: id, active: true, version: 2, created_at: '2026-10-09T08:00:00.000Z', updated_at: '2026-10-10T09:00:00.000Z' }));
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const overview = await screen.findByLabelText('Caseload overview');
    expect(within(overview).getByText('Assigned to You')).toBeVisible();
    expect(within(overview).getByText(/Assigned to Employment Specialist ending 333333/)).toBeVisible();
    expect(within(overview).getAllByText('First assigned: 09 Oct 2026, 09:00 BST')).toHaveLength(2);
    expect(within(overview).getAllByText('Last updated: 10 Oct 2026, 10:00 BST')).toHaveLength(2);
    expect(mocks.selections.programme_hub_participant_advisers).toContain('created_at,updated_at');
    expect(mocks.selections.workspace_members).toBe('user_id,role,status');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('searches the selected programme caseload without changing assignments', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_participants = [participantRow, { ...secondParticipantRow, programme_id: programmeId }];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const overview = await screen.findByLabelText('Caseload overview');
    fireEvent.change(within(overview).getByLabelText('Search caseload'), { target: { value: 'CASE-002' } });
    expect(within(overview).getByText('Sam · CASE-002')).toBeVisible();
    expect(within(overview).queryByText('Alex · CASE-001')).toBeNull();
    fireEvent.change(within(overview).getByLabelText('Search caseload'), { target: { value: 'no such person' } });
    expect(within(overview).getByText('No Service users match this search.')).toBeVisible();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does not describe inactive or suspended ES registrations as active assignments', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_advisers = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, user_id: adviserId, active: true, version: 1 }];
    mocks.rows.workspace_members.push({ workspace_id: workspaceId, user_id: adviserId, role: 'member', status: 'suspended' });
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const overview = await screen.findByLabelText('Caseload overview');
    expect(within(overview).getByText('No active Employment Specialist assigned.')).toBeVisible();
    expect(screen.getByLabelText('Employment Specialist for caseload')).not.toHaveTextContent('333333');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('keeps dates unavailable when absent instead of generating assignment dates', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_advisers = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, user_id: adviserId, active: true, version: 1 }];
    mocks.rows.workspace_members.push({ workspace_id: workspaceId, user_id: adviserId, role: 'member', status: 'active' });
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const overview = await screen.findByLabelText('Caseload overview');
    fireEvent.click(within(overview).getByText('View dates'));
    expect(within(overview).getByText('First assigned: Date unavailable')).toBeVisible();
    expect(within(overview).getByText('Last updated: Date unavailable')).toBeVisible();
  });

  it('clears caseload search and old connections when switching programmes', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    mocks.rows.programme_hub_participants = [participantRow, secondParticipantRow];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const overview = await screen.findByLabelText('Caseload overview');
    fireEvent.change(within(overview).getByLabelText('Search caseload'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('Choose a programme'), { target: { value: secondProgrammeId } });
    expect(within(overview).getByLabelText('Search caseload')).toHaveValue('');
    expect(within(overview).getByText('Sam · CASE-002')).toBeVisible();
    expect(within(overview).queryByText('Alex · CASE-001')).toBeNull();
  });

  it('shows an assigned ES the connection on the Service-user record without manager controls', async () => {
    setRows('member', true);
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={adviserId} />);
    const card = (await screen.findByRole('heading', { name: 'Alex' })).closest('article')!;
    expect(within(card).getByText('Assigned to You')).toBeVisible();
    expect(screen.queryByLabelText('Caseload overview')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Employment Specialist' })).toBeNull();
  });

  it('keeps team setup collapsed and removes technical assignment explanations', async () => {
    setRows('owner', true);
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const team = (await screen.findByText(/^Manage team/)).closest('details')!;
    expect(team).not.toHaveAttribute('open');
    expect(screen.queryByText(/Workspace ownership alone/)).toBeNull();
    expect(screen.queryByText(/signed-in actor/)).toBeNull();
    fireEvent.click(within(team).getByText(/^Manage team/));
    expect(within(team).getByRole('button', { name: 'Add Employment Specialist' })).toBeVisible();
  });

  it('shows a short already-assigned state and keeps assignment dates collapsed', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_advisers = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, user_id: adviserId, active: true, version: 1 }];
    mocks.rows.workspace_members.push({ workspace_id: workspaceId, user_id: adviserId, role: 'member', status: 'active' });
    mocks.rows.programme_hub_participant_advisers[0] = { ...mocks.rows.programme_hub_participant_advisers[0] as Record<string, unknown>, created_at: '2026-10-09T08:00:00.000Z', updated_at: '2026-10-10T09:00:00.000Z' };
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.change(await screen.findByLabelText('Service user for caseload'), { target: { value: participantId } });
    fireEvent.change(screen.getByLabelText('Employment Specialist for caseload'), { target: { value: adviserId } });
    expect(screen.getByRole('button', { name: 'Already assigned' })).toBeDisabled();
    expect(screen.queryByText(/no duplicate assignment will be submitted/)).toBeNull();
    const overview = screen.getByLabelText('Caseload overview');
    expect(within(overview).getByText('1 Service user · All assigned')).toBeVisible();
    const dates = within(overview).getByText('View dates').closest('details')!;
    expect(dates).not.toHaveAttribute('open');
    expect(within(dates).getByText('First assigned: 09 Oct 2026, 09:00 BST')).not.toBeVisible();
    fireEvent.click(within(dates).getByText('View dates'));
    expect(within(dates).getByText('First assigned: 09 Oct 2026, 09:00 BST')).toBeVisible();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('opens the existing record and all its programme notes directly from the caseload', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_participant_notes = [
      { id: savedId, workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, body: 'First agreed action', author_user_id: ownerId, created_at: '2026-10-09T08:00:00.000Z', version: 1 },
      { id: '99999999-9999-4999-8999-999999999999', workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, body: 'Latest agreed action', author_user_id: ownerId, created_at: '2026-10-10T08:00:00.000Z', version: 1 },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workspace_id: workspaceId, programme_id: secondProgrammeId, participant_id: secondParticipantId, body: 'Other programme private note', author_user_id: ownerId, created_at: '2026-10-10T09:00:00.000Z', version: 1 },
    ];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const overview = await screen.findByLabelText('Caseload overview');
    fireEvent.click(within(overview).getByRole('button', { name: 'Open Service-user record' }));
    const card = screen.getByRole('article', { name: 'Alex — Employment Support record' });
    await waitFor(() => expect(card).toHaveFocus());
    expect(within(card).getByText('Programme: Employment Support')).toBeVisible();
    expect(within(card).getByText('customer_service')).toBeVisible();
    expect(await within(card).findByText('Latest agreed action')).toBeVisible();
    expect(within(card).getByText('First agreed action')).toBeVisible();
    expect(screen.getAllByText('Latest agreed action')).toHaveLength(1);
    expect(screen.queryByText('Other programme private note')).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('lets an assigned ES search names with spaces and open their existing record', async () => {
    setRows('member', true);
    mocks.rows.programme_hub_participants = [{ ...participantRow, preferred_name: 'Alex Jordan' }];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={adviserId} />);
    fireEvent.change(await screen.findByLabelText('Search Service users'), { target: { value: ' alex   jordan ' } });
    const card = screen.getByRole('article', { name: 'Alex Jordan — Employment Support record' });
    fireEvent.click(within(card).getByRole('button', { name: 'Open Service-user record' }));
    await waitFor(() => expect(card).toHaveFocus());
    expect(within(card).getByText('customer_service')).toBeVisible();
    expect(within(card).getByLabelText('Add a note')).toBeVisible();
    expect(screen.queryByLabelText('Caseload overview')).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does not carry an opened record or its notes into another programme', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    mocks.rows.programme_hub_participants = [participantRow, secondParticipantRow];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.click(within(await screen.findByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    expect(screen.getByRole('article', { name: 'Alex — Employment Support record' })).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Choose a programme'), { target: { value: secondProgrammeId } });
    expect(screen.queryByRole('article', { name: 'Alex — Employment Support record' })).toBeNull();
    const sam = screen.getByRole('article', { name: 'Sam — Youth Employment record' });
    expect(within(sam).getByText(/^Case notes/).closest('details')).not.toHaveAttribute('open');
  });

  it('saves optional contact details through the trusted boundary and reads them after remount', async () => {
    setRows('owner', true);
    mocks.invoke.mockImplementation(async (_name: string, { body }: { body: Record<string, unknown> }) => {
      const p = body.payload as Record<string, string>;
      mocks.rows.programme_hub_participant_contacts = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, phone: p.phone, email: p.email, address_line_1: p.addressLine1, address_line_2: p.addressLine2 || null, town: p.town, postcode: p.postcode, version: 1 }];
      return { data: { operation: body.operation, recordId: savedId, workspaceId, programmeId, version: 1 }, error: null };
    });
    const first = render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.click(within(await screen.findByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    const card = screen.getByRole('article', { name: 'Alex — Employment Support record' });
    fireEvent.click(await within(card).findByRole('button', { name: 'Add contact details' }));
    fireEvent.change(within(card).getByLabelText('Phone number'), { target: { value: '0121 555 0100' } });
    fireEvent.change(within(card).getByLabelText('Email address'), { target: { value: 'alex@example.test' } });
    fireEvent.change(within(card).getByLabelText('Address line 1'), { target: { value: '1 Test Road' } });
    fireEvent.change(within(card).getByLabelText('UK postcode'), { target: { value: ' b11aa ' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save contact details' }));
    expect(await within(card).findByText('Contact details saved.')).toBeVisible();
    expect(mocks.invoke.mock.calls[0][1].body).toMatchObject({ operation: 'participant_contact', recordId: null, expectedVersion: 0, payload: { participantId, postcode: 'B1 1AA', phone: '0121 555 0100' } });
    expect(await within(card).findByText('alex@example.test')).toBeVisible();
    first.unmount();
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.click(within(await screen.findByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    expect(await screen.findByText('alex@example.test')).toBeVisible();
    expect(screen.getByText('B1 1AA')).toBeVisible();
  });

  it('keeps a failed contact read separate from profiles and notes', async () => {
    setRows('owner', true); mocks.contactReadFails = true;
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.click(within(await screen.findByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    const card = screen.getByRole('article', { name: 'Alex — Employment Support record' });
    expect(await within(card).findByRole('alert')).toHaveTextContent('Contact details are unavailable');
    expect(within(card).queryByText('No contact details added.')).toBeNull();
    expect(within(card).getByText('customer_service')).toBeVisible();
    expect(within(card).getByLabelText('Add a note')).toBeVisible();
  });

  it('retains and retries the exact contact request after an uncertain save', async () => {
    setRows('owner', true);
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('network unavailable') });
    const first = render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.click(within(await screen.findByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    const card = screen.getByRole('article', { name: 'Alex — Employment Support record' });
    fireEvent.click(await within(card).findByRole('button', { name: 'Add contact details' }));
    fireEvent.change(within(card).getByLabelText('Phone number'), { target: { value: '0121 555 0200' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save contact details' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('outcome is unknown');
    const original = mocks.invoke.mock.calls[0][1].body;
    first.unmount();
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const restoredCard = await screen.findByRole('article', { name: 'Alex — Employment Support record' });
    expect(await within(restoredCard).findByLabelText('Phone number')).toHaveValue('0121 555 0200');
    expect(within(restoredCard).getByLabelText('Phone number')).toHaveValue('0121 555 0200');
    mocks.invoke.mockResolvedValueOnce({ data: { operation: 'participant_contact', recordId: savedId, workspaceId, programmeId, version: 1 }, error: null });
    fireEvent.click(within(restoredCard).getByRole('button', { name: 'Retry same change' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls[1][1].body).toEqual(original);
  });

  it('validates contact details locally without invoking a save', async () => {
    setRows('owner', true);
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.click(within(await screen.findByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    const card = screen.getByRole('article', { name: 'Alex — Employment Support record' });
    fireEvent.click(await within(card).findByRole('button', { name: 'Add contact details' }));
    fireEvent.change(within(card).getByLabelText('UK postcode'), { target: { value: 'unknown' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save contact details' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Enter a UK postcode');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('lets an assigned ES edit the loaded contact version without changing the employment profile', async () => {
    setRows('member', true);
    mocks.rows.programme_hub_participant_contacts = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, phone: '0121 555 0100', email: null, address_line_1: null, address_line_2: null, town: null, postcode: null, version: 3 }];
    mocks.invoke.mockImplementation(async (_name: string, { body }: { body: Record<string, unknown> }) => ({ data: { operation: body.operation, recordId: savedId, workspaceId, programmeId, version: 4 }, error: null }));
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={adviserId} />);
    const card = (await screen.findByRole('heading', { name: 'Alex' })).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Open Service-user record' }));
    fireEvent.click(await within(card).findByRole('button', { name: 'Edit contact details' }));
    fireEvent.change(within(card).getByLabelText('Phone number'), { target: { value: '0121 555 0200' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save contact details' }));
    expect(await within(card).findByText('Contact details saved.')).toBeVisible();
    expect(mocks.invoke.mock.calls[0][1].body).toMatchObject({ operation: 'participant_contact', recordId: savedId, expectedVersion: 3, payload: { participantId, phone: '0121 555 0200' } });
    expect(mocks.invoke.mock.calls[0][1].body.payload).not.toHaveProperty('skillKeys');
  });

  it('clears contact details when another programme is selected', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    mocks.rows.programme_hub_participants = [participantRow, secondParticipantRow];
    mocks.rows.programme_hub_participant_contacts = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, phone: '0121 555 0100', email: null, address_line_1: null, address_line_2: null, town: null, postcode: null, version: 1 }];
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.click(within(await screen.findByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    expect(await screen.findByText('0121 555 0100')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Choose a programme'), { target: { value: secondProgrammeId } });
    fireEvent.click(within(screen.getByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    expect(await screen.findByText('No contact details added.')).toBeVisible();
    expect(screen.queryByText('0121 555 0100')).toBeNull();
  });

});
