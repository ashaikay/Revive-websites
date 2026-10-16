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
  caseloadReadFails: false,
  readGate: null as Promise<void> | null,
  download: vi.fn(),
  rpc: vi.fn(),
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
      let range: [number, number] | null = null;
      const filtered = () => (mocks.rows[table] ?? []).filter((row) => filters.every(([column, value]) => (row as Record<string, unknown>)[column] === value));
      const result = () => ({
        data: range ? filtered().slice(range[0], range[1] + 1) : filtered(),
        count: filtered().length,
        error: (mocks.caseloadReadFails && table === 'programme_hub_participants') || (mocks.notesReadFails && table === 'programme_hub_participant_notes') || (mocks.contactReadFails && table === 'programme_hub_participant_contacts') ? new Error('read unavailable') : null,
      });
      const query = {
        select: (columns: string) => { mocks.selections[table] = columns; return query; },
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        order: () => query,
        range: (from: number, to: number) => { range = [from, to]; return query; },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(mocks.readGate).then(() => result()).then(resolve, reject),
      };
      return query;
    },
    rpc: (...args: unknown[]) => mocks.rpc(...args),
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

vi.mock('@/services/programmeCaseloadReporting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/programmeCaseloadReporting')>();
  return { ...actual, downloadCaseloadWorkbook: (...args: unknown[]) => mocks.download(...args) };
});

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
  mocks.caseloadReadFails = false;
  mocks.readGate = null;
  mocks.download.mockReset();
  mocks.rpc.mockReset().mockImplementation(async (name: string, input: {target_workspace_id: string}) => ({ data: name === 'list_rev_workspace_staff_names' ? [] : { workspaceId: input.target_workspace_id, members: (mocks.rows.workspace_members ?? []).map((row) => ({ userId: (row as Record<string, unknown>).user_id, role: (row as Record<string, unknown>).role, status: (row as Record<string, unknown>).status, displayName: null, nameVersion: 0 })), invitations: [] }, error: null }));
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

async function navigateHub(area: string) {
  const nav = await screen.findByRole('navigation', { name: 'Employment support areas' });
  const button = within(nav).queryByRole('button', { name: area }) ?? (area === 'Caseload' ? within(nav).getByRole('button', { name: 'My caseload' }) : null);
  if (!button) throw new Error(`Area unavailable: ${area}`);
  if (!(button as HTMLButtonElement).disabled) fireEvent.click(button);
}
async function renderHub(element: React.ReactElement, area = 'Caseload') {
  const result = render(element);
  await screen.findByRole('heading', { name: 'Employment support' });
  await navigateHub(area);
  if (area === 'My team') {
    const summary = screen.getByText('Assign an Employment Specialist');
    if (!summary.closest('details')?.open) fireEvent.click(summary);
  }
  for (const label of area === 'Employers' ? ['Add employer', 'Add employer contact'] : area === 'Job opportunities' ? ['Add job opportunity'] : []) {
    const summary = screen.getByText(label);
    if (!summary.closest('details')?.open) fireEvent.click(summary);
  }
  return result;
}

async function openServiceUser(name = 'Alex') {
  await navigateHub('Caseload');
  const overview = await screen.findByLabelText('Caseload overview');
  const row = within(overview).getByText(new RegExp(`^${name} ·`)).closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Open Service-user record' }));
  return await screen.findByRole('article', { name: new RegExp(`^${name} —`) });
}

describe('Outcomes / Programme Hub employer foundation', () => {
  it('separates everyday work from manager settings instead of showing all sections together', async () => {
    setRows('owner');
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const nav = await screen.findByRole('navigation', { name: 'Employment support areas' });
    expect(within(nav).getByRole('button', { name: 'My team' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'My team' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Employers' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Job opportunities' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create programme' })).toBeNull();
    await navigateHub('Settings');
    const settings = screen.getByText('Programme settings').closest('details')!;
    expect(settings).not.toHaveAttribute('open');
    expect(within(settings).getByText(/Advanced setup/)).toHaveTextContent('You can still manage records and case notes.');
    expect(screen.queryByRole('heading', { name: 'My team' })).toBeNull();
    expect(screen.queryByText(/Tenant-neutral/)).toBeNull();
    expect(screen.queryByRole('button', { name: /send/i })).toBeNull();
  });

  it('submits a tenant-neutral employer through the trusted versioned boundary', async () => {
    setRows('owner');
    mocks.invoke.mockImplementation(async (_name: string, { body }: { body: Record<string, unknown> }) => ({
      data: { operation: body.operation, recordId: savedId, workspaceId, programmeId, version: 1 },
      error: null,
    }));
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Employers');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Employers');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Employers');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Employers');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Employers');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={adviserId} />, 'Caseload');
    expect(await screen.findByRole('heading', { name: 'My caseload' })).toBeVisible();
    expect(screen.getByText(/Alex/)).toBeVisible();
    await openServiceUser();
    expect(screen.getByText('Case reference: CASE-001')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Advisers and caseload' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Participant employment profiles' })).toBeNull();
    expect(screen.queryByText('Programme settings')).toBeNull();
    expect(screen.getByText(/No address evidence recorded/)).toBeVisible();
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'My team');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'My team');
    expect(await screen.findByText(/Add an ES to this programme first/)).toBeVisible();
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'My team');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'My team');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'My team');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    expect(await screen.findByText('Alex · CASE-001')).toBeVisible();
    expect(screen.queryByText('Sam · CASE-002')).toBeNull();
    fireEvent.click(screen.getByText('New Service user'));
    fireEvent.change(screen.getByLabelText('Service user ID'), { target: { value: 'DRAFT-OLD' } });
    fireEvent.change(screen.getByLabelText('Choose a programme'), { target: { value: secondProgrammeId } });
    await navigateHub('Caseload');
    expect(await screen.findByText(/You are viewing/)).toHaveTextContent('Youth Employment');
    expect(screen.getByText('Sam · CASE-002')).toBeVisible();
    expect(screen.queryByText('Alex · CASE-001')).toBeNull();
    expect(screen.getByLabelText('Service user ID')).toHaveValue('');
  });

  it('restores only the selected programme ID after refresh for the same workspace and user', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    mocks.rows.programme_hub_participants = [participantRow, secondParticipantRow];
    const first = await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    fireEvent.change(await screen.findByLabelText('Choose a programme'), { target: { value: secondProgrammeId } });
    await navigateHub('Caseload');
    expect(await screen.findByText(/You are viewing/)).toHaveTextContent('Youth Employment');
    expect(window.localStorage.getItem(`rev-programme-hub-selection:${workspaceId}:${ownerId}`)).toBe(secondProgrammeId);
    expect(window.localStorage.length).toBe(1);
    first.unmount();

    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    expect(await screen.findByLabelText('Choose a programme')).toHaveValue(secondProgrammeId);
    expect(screen.getByText('Sam · CASE-002')).toBeVisible();
    expect(screen.queryByText('Alex · CASE-001')).toBeNull();
  });

  it('does not reuse a programme preference after the signed-in user changes', async () => {
    const secondUserId = '22222222-2222-4222-8222-333333333333';
    setRows('owner', true);
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    mocks.rows.programme_hub_participants = [participantRow, secondParticipantRow];
    window.localStorage.setItem(`rev-programme-hub-selection:${workspaceId}:${ownerId}`, secondProgrammeId);
    mocks.rows.workspace_members = [{ workspace_id: workspaceId, user_id: secondUserId, role: 'owner', status: 'active' }];
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={secondUserId} />, 'Caseload');
    expect(await screen.findByLabelText('Choose a programme')).toHaveValue(programmeId);
    expect(screen.getByText('Alex · CASE-001')).toBeVisible();
    expect(screen.queryByText('Sam · CASE-002')).toBeNull();
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
    await renderHub(<ProgrammeHubModule workspaceId={secondWorkspaceId} userId={ownerId} />, 'Caseload');
    expect(await screen.findByLabelText('Choose a programme')).toHaveValue(programmeId);
    expect(window.localStorage.getItem(`rev-programme-hub-selection:${secondWorkspaceId}:${ownerId}`)).toBe(programmeId);
    expect(window.localStorage.getItem(`rev-programme-hub-selection:${workspaceId}:${ownerId}`)).toBe(secondProgrammeId);
  });

  it('falls back safely when access to the stored programme has been revoked', async () => {
    setRows('owner', true);
    window.localStorage.setItem(`rev-programme-hub-selection:${workspaceId}:${ownerId}`, secondProgrammeId);
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    expect(await screen.findByLabelText('Choose a programme')).toHaveValue(programmeId);
    expect(screen.getByText('Alex · CASE-001')).toBeVisible();
    expect(screen.queryByText('Sam · CASE-002')).toBeNull();
    expect(window.localStorage.getItem(`rev-programme-hub-selection:${workspaceId}:${ownerId}`)).toBe(programmeId);
  });

  it('shows programme-scoped notes newest first with server author and programme time', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_participant_notes = [
      { id: '88888888-8888-4888-8888-888888888888', workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, body: 'Older action', author_user_id: ownerId, created_at: '2026-10-09T08:00:00.000Z', version: 1 },
      { id: '99999999-9999-4999-8999-999999999999', workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, body: 'Newest action', author_user_id: ownerId, created_at: '2026-10-09T09:00:00.000Z', version: 1 },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workspace_id: workspaceId, programme_id: secondProgrammeId, participant_id: secondParticipantId, body: 'Other programme note', author_user_id: ownerId, created_at: '2026-10-09T10:00:00.000Z', version: 1 },
    ];
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    await openServiceUser();
    const summary = await screen.findByText(/^Case notes \(2\)/);
    expect(summary.closest('details')).toHaveAttribute('open');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    await openServiceUser();
    const note = await screen.findByLabelText('Add a note');
    fireEvent.change(note, { target: { value: '  Agreed to update the CV this week.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save case note' }));
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Employers');
    const contact = (await screen.findByRole('heading', { name: 'Taylor' })).closest('article')!;
    fireEvent.click(within(contact).getByText('View details'));
    expect(within(contact).getByText('taylor@example.org')).toBeVisible();
    expect(within(contact).getByText('Hiring manager')).toBeVisible();
    expect(within(contact).getByText('Not provided')).toBeVisible();
    await navigateHub('Job opportunities');
    const opportunity = screen.getByRole('heading', { name: 'Chef opportunity' }).closest('article')!;
    fireEvent.click(within(opportunity).getByText('View details'));
    expect(within(opportunity).getByText('food_safety')).toBeVisible();
    expect(within(opportunity).getByText('teamwork')).toBeVisible();
    const participant = await openServiceUser();
    expect(within(participant).getByText('customer_service')).toBeVisible();
    expect(within(participant).getByText('configured-area')).toBeVisible();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('keeps only one record open and preserves note drafts when returning to it', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_participants = [participantRow, { ...secondParticipantRow, programme_id: programmeId }];
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    const alex = await openServiceUser();
    fireEvent.change(within(alex).getByLabelText('Add a note'), { target: { value: 'Keep my draft' } });
    await openServiceUser('Sam');
    expect(screen.queryByRole('article', { name: /^Alex —/ })).toBeNull();
    expect(screen.getAllByRole('article', { name: / record$/ })).toHaveLength(1);
    const restored = await openServiceUser();
    expect(within(restored).getByLabelText('Add a note')).toHaveValue('Keep my draft');
    expect(screen.queryByRole('article', { name: /^Sam —/ })).toBeNull();
  });

  it('shows contact validation beside its save action rather than at the top of the page', async () => {
    setRows('owner');
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Employers');
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
    ['Service users', 'participant', [['Service user ID', 'PART-SAVE'], ['Known as', 'Robin'], ['Case reference', 'CASE-SAVE']], 'Service user added.'],
  ])('shows progress and confirmation beside the %s form', async (heading, operation, values, confirmation) => {
    setRows('owner');
    mocks.rows.programme_hub_employers = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, employer_key: 'EMP-EXISTING', display_name: 'Existing employer', sector_key: null, primary_geography_key: null, active: true, version: 1 }];
    let resolveSave!: (value: unknown) => void;
    mocks.invoke.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, operation === 'participant' ? 'Caseload' : operation === 'vacancy' ? 'Job opportunities' : 'Employers');
    await screen.findByLabelText('Choose a programme');
    if (heading === 'Service users') fireEvent.click(screen.getByText('New Service user'));
    const sections = (await screen.findAllByRole('heading', { name: heading })).map((item) => item.closest(heading === 'Service users' ? 'details' : 'section')!);
    const section = sections.find((item) => within(item).queryByRole('button', { name: operation === 'participant' ? 'Add Service user' : 'Add record' }))!;
    const form = within(section).getByRole('button', { name: operation === 'participant' ? 'Add Service user' : 'Add record' }).closest('form')!;
    for (const [label, value] of values as string[][]) fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    fireEvent.click(within(form).getByRole('button', { name: operation === 'participant' ? 'Add Service user' : 'Add record' }));
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Settings');
    fireEvent.click(await screen.findByText('Programme configuration'));
    const configuration = screen.getByText('Programme configuration').closest('details')!;
    fireEvent.change(within(configuration).getByLabelText('Programme name'), { target: { value: 'New programme' } });
    fireEvent.click(within(configuration).getByRole('button', { name: 'Create programme' }));
    expect(await within(configuration).findByRole('button', { name: 'Saving...' })).toBeDisabled();
    resolveSave({ data: { operation: 'programme', recordId: savedId, workspaceId, programmeId, version: 1 }, error: null });
    expect(await within(configuration).findByText('Programme created.')).toBeVisible();
    await navigateHub('My team');
    fireEvent.click(screen.getByText(/^Add ES to programme/));
    fireEvent.change(screen.getByLabelText('Organisation member to add as Employment Specialist'), { target: { value: ownerId } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Employment Specialist' }));
    const caseload = screen.getByRole('heading', { name: 'My team' }).closest('section')!;
    expect(await within(caseload).findByRole('button', { name: 'Saving...' })).toBeDisabled();
    resolveSave({ data: { operation: 'adviser', recordId: savedId, workspaceId, programmeId, version: 1 }, error: null });
    expect(await within(caseload).findByText('Employment Specialist added.')).toBeVisible();
  });

  it('does not show a failed notes read as an empty timeline', async () => {
    setRows('owner', true);
    mocks.notesReadFails = true;
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    await openServiceUser();
    const summary = await screen.findByText(/^Case notes \(could not load\)/);
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(screen.getByText(/Case notes could not be loaded/)).toBeVisible();
    expect(screen.queryByText(/No notes have been added/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save case note' })).toBeDisabled();
  });

  it('shows all active ES connections with server dates in the programme timezone', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_advisers = [ownerId, adviserId].map((id, index) => ({ id: index === 0 ? savedId : participantId, workspace_id: workspaceId, programme_id: programmeId, user_id: id, active: true, version: 1 }));
    mocks.rows.workspace_members.push({ workspace_id: workspaceId, user_id: adviserId, role: 'member', status: 'active' });
    mocks.rows.programme_hub_participant_advisers = [ownerId, adviserId].map((id, index) => ({ id: index === 0 ? savedId : participantId, workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, adviser_user_id: id, active: true, version: 2, created_at: '2026-10-09T08:00:00.000Z', updated_at: '2026-10-10T09:00:00.000Z' }));
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    const overview = await screen.findByLabelText('Caseload overview');
    expect(within(overview).getByText(/Assigned to You, Employment Specialist ending 333333/)).toBeVisible();
    expect(within(overview).queryByText('View dates')).toBeNull();
    const record = await openServiceUser();
    expect(within(record).getAllByText('First assigned: 09 Oct 2026, 09:00 BST')).toHaveLength(2);
    expect(within(record).getAllByText('Last updated: 10 Oct 2026, 10:00 BST')).toHaveLength(2);
    expect(mocks.selections.programme_hub_participant_advisers).toContain('created_at,updated_at');
    expect(mocks.selections.workspace_members).toBe('user_id,role,status');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('searches the selected programme caseload without changing assignments', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_participants = [participantRow, { ...secondParticipantRow, programme_id: programmeId }];
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    const overview = await screen.findByLabelText('Caseload overview');
    expect(within(overview).getByText('No active Employment Specialist assigned.')).toBeVisible();
    expect(screen.getByLabelText('Employment Specialist for caseload')).not.toHaveTextContent('333333');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('keeps dates unavailable when absent instead of generating assignment dates', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_advisers = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, user_id: adviserId, active: true, version: 1 }];
    mocks.rows.workspace_members.push({ workspace_id: workspaceId, user_id: adviserId, role: 'member', status: 'active' });
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    const overview = await screen.findByLabelText('Caseload overview');
    expect(within(overview).queryByText('View dates')).toBeNull();
    const record = await openServiceUser();
    fireEvent.click(within(record).getByText('View dates'));
    expect(within(record).getByText('First assigned: Date unavailable')).toBeVisible();
    expect(within(record).getByText('Last updated: Date unavailable')).toBeVisible();
  });

  it('clears caseload search and old connections when switching programmes', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    mocks.rows.programme_hub_participants = [participantRow, secondParticipantRow];
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    const overview = await screen.findByLabelText('Caseload overview');
    fireEvent.change(within(overview).getByLabelText('Search caseload'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('Choose a programme'), { target: { value: secondProgrammeId } });
    await navigateHub('Caseload');
    expect(within(overview).getByLabelText('Search caseload')).toHaveValue('');
    expect(within(overview).getByText('Sam · CASE-002')).toBeVisible();
    expect(within(overview).queryByText('Alex · CASE-001')).toBeNull();
  });

  it('shows an assigned ES the connection on the Service-user record without manager controls', async () => {
    setRows('member', true);
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={adviserId} />, 'Caseload');
    const card = await openServiceUser();
    expect(within(card).getByText('Assigned to You')).toBeVisible();
    expect(screen.getByLabelText('Caseload overview')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add Employment Specialist' })).toBeNull();
  });

  it('keeps team setup collapsed and removes technical assignment explanations', async () => {
    setRows('owner', true);
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'My team');
    const team = (await screen.findByText(/^Add ES to programme/)).closest('details')!;
    expect(team).not.toHaveAttribute('open');
    expect(screen.queryByText(/Workspace ownership alone/)).toBeNull();
    expect(screen.queryByText(/signed-in actor/)).toBeNull();
    fireEvent.click(within(team).getByText(/^Add ES to programme/));
    expect(within(team).getByRole('button', { name: 'Add Employment Specialist' })).toBeVisible();
  });

  it('shows a short already-assigned state and keeps assignment dates collapsed', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_advisers = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, user_id: adviserId, active: true, version: 1 }];
    mocks.rows.workspace_members.push({ workspace_id: workspaceId, user_id: adviserId, role: 'member', status: 'active' });
    mocks.rows.programme_hub_participant_advisers[0] = { ...mocks.rows.programme_hub_participant_advisers[0] as Record<string, unknown>, created_at: '2026-10-09T08:00:00.000Z', updated_at: '2026-10-10T09:00:00.000Z' };
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'My team');
    fireEvent.change(await screen.findByLabelText('Service user for caseload'), { target: { value: participantId } });
    fireEvent.change(screen.getByLabelText('Employment Specialist for caseload'), { target: { value: adviserId } });
    expect(screen.getByRole('button', { name: 'Already assigned' })).toBeDisabled();
    expect(screen.queryByText(/no duplicate assignment will be submitted/)).toBeNull();
    await navigateHub('Caseload');
    const overview = screen.getByLabelText('Caseload overview');
    expect(within(overview).getByText('1 Service user · All assigned')).toBeVisible();
    expect(within(overview).queryByText('View dates')).toBeNull();
    const record = await openServiceUser();
    const dates = within(record).getByText('View dates').closest('details')!;
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={adviserId} />, 'Caseload');
    fireEvent.change(await screen.findByLabelText('Search caseload'), { target: { value: ' alex   jordan ' } });
    const card = await openServiceUser('Alex Jordan');
    await waitFor(() => expect(card).toHaveFocus());
    expect(within(card).getByText('customer_service')).toBeVisible();
    expect(within(card).getByLabelText('Add a note')).toBeVisible();
    expect(screen.getByLabelText('Caseload overview')).toBeVisible();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does not carry an opened record or its notes into another programme', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    mocks.rows.programme_hub_participants = [participantRow, secondParticipantRow];
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    fireEvent.click(within(await screen.findByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    expect(screen.getByRole('article', { name: 'Alex — Employment Support record' })).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Choose a programme'), { target: { value: secondProgrammeId } });
    await navigateHub('Caseload');
    expect(screen.queryByRole('article', { name: 'Alex — Employment Support record' })).toBeNull();
    expect(screen.queryByRole('article', { name: 'Sam — Youth Employment record' })).toBeNull();
    expect(screen.getByText('Sam · CASE-002')).toBeVisible();
  });

  it('saves optional contact details through the trusted boundary and reads them after remount', async () => {
    setRows('owner', true);
    mocks.invoke.mockImplementation(async (_name: string, { body }: { body: Record<string, unknown> }) => {
      const p = body.payload as Record<string, string>;
      mocks.rows.programme_hub_participant_contacts = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, phone: p.phone, email: p.email, address_line_1: p.addressLine1, address_line_2: p.addressLine2 || null, town: p.town, postcode: p.postcode, version: 1 }];
      return { data: { operation: body.operation, recordId: savedId, workspaceId, programmeId, version: 1 }, error: null };
    });
    const first = await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    fireEvent.click(within(await screen.findByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    expect(await screen.findByText('alex@example.test')).toBeVisible();
    expect(screen.getByText('B1 1AA')).toBeVisible();
  });

  it('keeps a failed contact read separate from profiles and notes', async () => {
    setRows('owner', true); mocks.contactReadFails = true;
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
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
    const first = await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    fireEvent.click(within(await screen.findByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    const card = screen.getByRole('article', { name: 'Alex — Employment Support record' });
    fireEvent.click(await within(card).findByRole('button', { name: 'Add contact details' }));
    fireEvent.change(within(card).getByLabelText('Phone number'), { target: { value: '0121 555 0200' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save contact details' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('outcome is unknown');
    const original = mocks.invoke.mock.calls[0][1].body;
    first.unmount();
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={adviserId} />, 'Caseload');
    const card = await openServiceUser();
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
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    fireEvent.click(within(await screen.findByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    expect(await screen.findByText('0121 555 0100')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Choose a programme'), { target: { value: secondProgrammeId } });
    await navigateHub('Caseload');
    fireEvent.click(within(screen.getByLabelText('Caseload overview')).getByRole('button', { name: 'Open Service-user record' }));
    expect(await screen.findByText('No contact details added.')).toBeVisible();
    expect(screen.queryByText('0121 555 0100')).toBeNull();
  });

  it('shows ten rows at a time and reads no private contacts until a record is opened', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_participants = Array.from({ length: 25 }, (_, index) => ({ ...participantRow,
      id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`, participant_key: `PART-${index + 1}`, preferred_name: `Person ${String(index + 1).padStart(2, '0')}`, case_reference: `CASE-${index + 1}`,
    }));
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    const overview = await screen.findByLabelText('Caseload overview');
    expect(within(overview).getAllByRole('listitem')).toHaveLength(10);
    expect(within(overview).getByText('1–10 of 25')).toBeVisible();
    expect(screen.queryByLabelText('Selected Service-user record')).toBeNull();
    expect(mocks.selections.programme_hub_participant_contacts).toBeUndefined();
    fireEvent.click(within(overview).getByRole('button', { name: 'Next' }));
    expect(within(overview).getByText('11–20 of 25')).toBeVisible();
    const record = await openServiceUser('Person 11');
    fireEvent.click(within(overview).getByRole('button', { name: 'Next' }));
    expect(within(overview).getAllByRole('listitem')).toHaveLength(5);
    expect(within(overview).getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(record).toBeVisible();
    fireEvent.change(within(overview).getByLabelText('Search caseload'), { target: { value: 'Person 25' } });
    expect(within(overview).getByText('1–1 of 1')).toBeVisible();
    expect(within(overview).getAllByRole('listitem')).toHaveLength(1);
    expect(record).toBeVisible();
    fireEvent.change(within(overview).getByLabelText('Search caseload'), { target: { value: '' } });
    expect(within(overview).getByText('1–10 of 25')).toBeVisible();
    fireEvent.click(within(overview).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(overview).getByRole('button', { name: 'Previous' }));
    expect(within(overview).getByText('Page 1 of 3')).toBeVisible();
    expect(screen.getAllByRole('article', { name: / record$/ })).toHaveLength(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('keeps contact edits in place until saved or cancelled', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    mocks.rows.programme_hub_participants = [participantRow, { ...secondParticipantRow, programme_id: programmeId }];
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    const card = await openServiceUser();
    fireEvent.click(await within(card).findByRole('button', { name: 'Add contact details' }));
    fireEvent.change(within(card).getByLabelText('Phone number'), { target: { value: '0121 555 0100' } });
    expect(screen.getByLabelText('Choose a programme')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close record' })).toBeDisabled();
    const overview = screen.getByLabelText('Caseload overview');
    for (const button of within(overview).getAllByRole('button', { name: 'Open Service-user record' })) expect(button).toBeDisabled();
    fireEvent.click(within(overview).getAllByRole('button', { name: 'Open Service-user record' })[1]);
    expect(within(card).getByLabelText('Phone number')).toHaveValue('0121 555 0100');
    expect(screen.queryByRole('article', { name: /^Sam —/ })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close record' })).toBeEnabled());
    await openServiceUser('Sam');
    expect(screen.queryByRole('article', { name: /^Alex —/ })).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('preserves employment-profile edits until saved or cancelled', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_participants = [participantRow, { ...secondParticipantRow, programme_id: programmeId }];
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    const card = await openServiceUser();
    fireEvent.click(within(card).getByRole('button', { name: 'Edit profile' }));
    fireEvent.change(screen.getByLabelText('Jobs of interest'), { target: { value: 'retail, hospitality' } });
    expect(screen.getByRole('button', { name: 'Close record' })).toBeDisabled();
    expect(screen.getByLabelText('Choose a programme')).toBeDisabled();
    expect(within(screen.getByLabelText('Caseload overview')).getAllByRole('button', { name: 'Open Service-user record' })[1]).toBeDisabled();
    expect(screen.getByLabelText('Jobs of interest')).toHaveValue('retail, hospitality');
    fireEvent.click(within(screen.getByLabelText('Selected Service-user record')).getByRole('button', { name: 'Cancel' }));
    await openServiceUser('Sam');
    expect(screen.queryByRole('article', { name: /^Alex —/ })).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('lets an assigned ES use the paginated list without exposing manager actions', async () => {
    setRows('member', true);
    mocks.rows.programme_hub_participants = Array.from({ length: 11 }, (_, index) => ({ ...participantRow,
      id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`, participant_key: `PART-${index + 1}`, preferred_name: `Assigned ${index + 1}`, case_reference: `CASE-${index + 1}`,
    }));
    mocks.rows.programme_hub_participant_advisers = mocks.rows.programme_hub_participants.map((person, index) => ({ id: `66666666-6666-4666-8666-${String(index + 1).padStart(12, '0')}`, workspace_id: workspaceId, programme_id: programmeId, participant_id: (person as Record<string, unknown>).id, adviser_user_id: adviserId, active: true, version: 1 }));
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={adviserId} />, 'Caseload');
    const overview = await screen.findByLabelText('Caseload overview');
    expect(within(overview).getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(within(overview).getByRole('button', { name: 'Next' }));
    const card = await openServiceUser('Assigned 11');
    expect(within(card).getByLabelText('Add a note')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Assign ES' })).toBeNull();
    expect(screen.queryByText('New Service user')).toBeNull();
    expect(screen.queryByText('Add ES to programme')).toBeNull();
  });

  it('keeps uncertain note saves pinned to the same record and exact request', async () => {
    setRows('owner', true);
    mocks.rows.programme_hub_participants = [participantRow, { ...secondParticipantRow, programme_id: programmeId }];
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('network unavailable') });
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    const card = await openServiceUser();
    fireEvent.change(within(card).getByLabelText('Add a note'), { target: { value: 'Agreed next action' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save case note' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('outcome is unknown');
    const original = mocks.invoke.mock.calls[0][1].body;
    expect(screen.getByRole('button', { name: 'Close record' })).toBeDisabled();
    expect(within(screen.getByLabelText('Caseload overview')).getAllByRole('button', { name: 'Open Service-user record' })[1]).toBeDisabled();
    mocks.invoke.mockResolvedValueOnce({ data: { operation: 'participant_note', recordId: savedId, workspaceId, programmeId, version: 1 }, error: null });
    fireEvent.click(within(card).getByRole('button', { name: 'Retry same change' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls[1][1].body).toEqual(original);
    expect(card).toBeVisible();
  });

  const setupEsOverview = () => {
    setRows('owner', true);
    mocks.rows.workspace_members.push({ workspace_id: workspaceId, user_id: adviserId, role: 'member', status: 'active' });
    mocks.rows.programme_hub_advisers = [ownerId, adviserId].map((user_id, index) => ({ id: index ? participantId : savedId, workspace_id: workspaceId, programme_id: programmeId, user_id, active: true, version: 1 }));
    mocks.rows.programme_hub_participants = [participantRow, { ...secondParticipantRow, programme_id: programmeId }, { ...participantRow, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', participant_key: 'PART-INACTIVE', preferred_name: 'Inactive person', case_reference: 'CASE-INACTIVE', active: false }];
    mocks.rows.programme_hub_participant_advisers = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, adviser_user_id: adviserId, active: true, version: 1, created_at: '2026-10-09T08:00:00Z', updated_at: '2026-10-10T08:00:00Z' }];
  };

  it('shows active ES counts separately from inactive records and filters unassigned people', async () => {
    setupEsOverview();
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    const tools = await screen.findByLabelText('Employment Specialist overview');
    expect(within(tools).getByText('Active Service users: 2 · Unassigned: 1')).toBeVisible();
    const filter = within(tools).getByLabelText('View ES caseload');
    expect(within(filter).getByText('Employment Specialist ending 333333 · 1 active')).toBeInTheDocument();
    expect(within(filter).getByText('You · 0 active')).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: adviserId } });
    const overview = screen.getByLabelText('Caseload overview');
    expect(within(overview).getByText('Alex · CASE-001')).toBeVisible();
    expect(within(overview).queryByText('Sam · CASE-002')).toBeNull();
    fireEvent.change(filter, { target: { value: 'unassigned' } });
    fireEvent.change(within(tools).getByLabelText('Record status'), { target: { value: 'active' } });
    expect(within(overview).getByText('Sam · CASE-002')).toBeVisible();
    expect(within(overview).queryByText(/Inactive person/)).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('exports all filtered rows after a fresh access check and excludes notes and contacts', async () => {
    setupEsOverview();
    mocks.rows.programme_hub_participant_notes = [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, body: 'Private case note', author_user_id: ownerId, created_at: '2026-10-09T08:00:00Z', version: 1 }];
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    fireEvent.change(await screen.findByLabelText('View ES caseload'), { target: { value: adviserId } });
    fireEvent.click(screen.getByRole('button', { name: 'Export caseload' }));
    const preview = screen.getByLabelText('Caseload export preview');
    expect(within(preview).getByText(/1 filtered Service user/)).toBeVisible();
    expect(within(preview).getByText(/Excludes case notes/)).toBeVisible();
    expect(mocks.download).not.toHaveBeenCalled();
    fireEvent.click(within(preview).getByRole('button', { name: 'Download Excel' }));
    expect(await screen.findByText('Excel download started: 1 Service user.')).toBeVisible();
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.download.mock.calls[0][0]).toEqual([['Employment Support', 'participant-001', 'Alex', 'CASE-001', 'Active', 'Employment Specialist ending 333333', '2026-10-09T08:00:00.000Z', '2026-10-10T08:00:00.000Z']]);
    expect(JSON.stringify(mocks.download.mock.calls)).not.toContain('Private case note');
    expect(mocks.selections.programme_hub_participant_contacts).toBeUndefined();
  });

  it('does not download stale data after a read failure or revoked membership', async () => {
    setupEsOverview();
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    fireEvent.click(await screen.findByRole('button', { name: 'Export caseload' }));
    mocks.caseloadReadFails = true;
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    expect(await screen.findByText(/The complete caseload could not be loaded/)).toBeVisible();
    expect(mocks.download).not.toHaveBeenCalled();
    mocks.caseloadReadFails = false;
    mocks.rows.workspace_members = [];
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    expect(await screen.findByText('Caseload access is unavailable.')).toBeVisible();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('requires review of changed rows before exporting again', async () => {
    setupEsOverview();
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    fireEvent.click(await screen.findByRole('button', { name: 'Export caseload' }));
    mocks.rows.programme_hub_participants[0] = { ...participantRow, preferred_name: 'Alex Updated' };
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    expect(await screen.findByText('Caseload changed. Review the updated list, then export again.')).toBeVisible();
    expect(screen.getByText('Alex Updated · CASE-001')).toBeVisible();
    expect(mocks.download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Export caseload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.download.mock.calls[0][0][0][2]).toBe('Alex Updated');
  });

  it('suppresses an in-flight export when the programme changes', async () => {
    setupEsOverview();
    mocks.rows.programme_hub_programmes = [programmeRow, secondProgrammeRow];
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    fireEvent.click(await screen.findByRole('button', { name: 'Export caseload' }));
    let release!: () => void;
    mocks.readGate = new Promise<void>((resolve) => { release = resolve; });
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    expect(screen.getByRole('button', { name: 'Checking access...' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Choose a programme'), { target: { value: secondProgrammeId } });
    await navigateHub('Caseload');
    release(); mocks.readGate = null;
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export caseload' })).toBeDisabled());
    expect(mocks.download).not.toHaveBeenCalled();
    expect(screen.queryByText(/Excel download started/)).toBeNull();
  });

  it('exports only an ES own active assignments and shows their own count', async () => {
    setupEsOverview();
    mocks.rows.workspace_members[0] = { workspace_id: workspaceId, user_id: ownerId, role: 'member', status: 'active' };
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={adviserId} />, 'Caseload');
    expect(await screen.findByText('My active caseload: 1')).toBeVisible();
    expect(screen.queryByLabelText('View ES caseload')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export caseload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.download.mock.calls[0][0]).toHaveLength(1);
    expect(mocks.download.mock.calls[0][0][0][2]).toBe('Alex');
    expect(mocks.download.mock.calls[0][0][0][5]).toBe('You');
    expect(screen.queryByRole('button', { name: 'Assign ES' })).toBeNull();
  });

  it('exports all matches across pages rather than just the ten visible rows', async () => {
    setupEsOverview();
    mocks.rows.programme_hub_participants = Array.from({ length: 25 }, (_, index) => ({ ...participantRow, id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`, participant_key: `PART-${index + 1}`, case_reference: `CASE-${index + 1}` }));
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    const overview = await screen.findByLabelText('Caseload overview');
    expect(within(overview).getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Export caseload' }));
    expect(screen.getByText(/25 filtered Service users/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.download.mock.calls[0][0]).toHaveLength(25);
  });

  it('cancels an in-flight export when its search filter changes', async () => {
    setupEsOverview();
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Caseload');
    fireEvent.click(await screen.findByRole('button', { name: 'Export caseload' }));
    let release!: () => void;
    mocks.readGate = new Promise<void>((resolve) => { release = resolve; });
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    fireEvent.change(screen.getByLabelText('Search caseload'), { target: { value: 'Alex' } });
    release(); mocks.readGate = null;
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export caseload' })).toBeEnabled());
    expect(mocks.download).not.toHaveBeenCalled();
    expect(screen.queryByText(/Excel download started/)).toBeNull();
  });

  it('opens an ES workspace from the team without showing unrelated employer or job forms', async () => {
    setupEsOverview();
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const list = await screen.findByLabelText('Programme Employment Specialists');
    const es = within(list).getByText('Employment Specialist ending 333333').closest('li')!;
    expect(within(es).getByText('1 active Service user')).toBeVisible();
    fireEvent.click(within(es).getByRole('button', { name: 'Open caseload' }));
    expect(screen.getByRole('heading', { name: 'Employment Specialist ending 333333 — caseload' })).toBeVisible();
    expect(screen.getByText('Active Service users: 1')).toBeVisible();
    expect(screen.getByText('Alex · CASE-001')).toBeVisible();
    expect(within(screen.getByLabelText('Caseload overview')).queryByText('Sam · CASE-002')).toBeNull();
    expect(screen.queryByRole('button', { name: 'SAVE ENGAGEMENT PLAN' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Job opportunities' })).toBeNull();
    await openServiceUser();
    expect(screen.getByRole('article', { name: 'Alex — Employment Support record' })).toBeVisible();
  });

  it('keeps unsaved employer, job and note drafts when navigating between related areas', async () => {
    setRows('owner', true);
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Employers');
    const employerForm = screen.getByLabelText('Employer name').closest('form')!;
    fireEvent.change(within(employerForm).getByLabelText('Employer name'), { target: { value: 'Keep employer draft' } });
    await navigateHub('Job opportunities');
    fireEvent.click(screen.getByText('Add job opportunity'));
    fireEvent.change(screen.getByLabelText('Vacancy title'), { target: { value: 'Keep opportunity draft' } });
    const card = await openServiceUser();
    fireEvent.change(within(card).getByLabelText('Add a note'), { target: { value: 'Keep note draft' } });
    await navigateHub('Employers');
    expect(screen.getByLabelText('Employer name')).toHaveValue('Keep employer draft');
    expect(screen.queryByRole('article', { name: /^Alex —/ })).toBeNull();
    await navigateHub('Job opportunities');
    expect(screen.getByLabelText('Vacancy title')).toHaveValue('Keep opportunity draft');
    await navigateHub('Caseload');
    expect(screen.getByRole('article', { name: /^Alex —/ })).toBeVisible();
    expect(within(card).getByLabelText('Add a note')).toHaveValue('Keep note draft');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('blocks area changes while editing private contact details', async () => {
    setRows('owner', true);
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const card = await openServiceUser();
    fireEvent.click(await within(card).findByRole('button', { name: 'Add contact details' }));
    fireEvent.change(within(card).getByLabelText('Phone number'), { target: { value: '0121 555 0100' } });
    const nav = screen.getByRole('navigation', { name: 'Employment support areas' });
    expect(within(nav).getByRole('button', { name: 'Employers' })).toBeDisabled();
    expect(within(nav).getByRole('button', { name: 'Settings' })).toBeDisabled();
    fireEvent.click(within(nav).getByRole('button', { name: 'Employers' }));
    expect(within(card).getByLabelText('Phone number')).toHaveValue('0121 555 0100');
    expect(card).toBeVisible();
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Employers' })).toBeEnabled());
  });

  it('keeps uncertain employer requests visible and blocks navigation until the exact retry', async () => {
    setRows('owner', true);
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('network unavailable') });
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Employers');
    fireEvent.click(screen.getByText('Employer outreach', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Programme offer for employer outreach'), { target: { value: 'We support local employers with recruitment and introductions.' } });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE PROGRAMME OFFER' }));
    const retry = await screen.findByRole('button', { name: 'Retry exact saved change' });
    expect(retry).toBeVisible();
    const original = mocks.invoke.mock.calls[0][1].body;
    const nav = screen.getByRole('navigation', { name: 'Employment support areas' });
    expect(within(nav).getByRole('button', { name: 'My team' })).toBeDisabled();
    expect(within(nav).getByRole('button', { name: 'Employers' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Choose a programme')).toBeDisabled();
    const disclosure = screen.getByText('Employer outreach', { selector: 'summary' }).closest('details')!;
    fireEvent.click(within(disclosure).getByText('Employer outreach', { selector: 'summary' }));
    await waitFor(() => expect(disclosure).toHaveAttribute('open'));
    mocks.invoke.mockResolvedValueOnce({ data: { operation: 'outreach_settings', recordId: savedId, workspaceId, programmeId, version: 1, duplicate: false }, error: null });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls[1][1].body).toEqual(original);
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'My team' })).toBeEnabled());
  });

  it('defaults an ES to their caseload and keeps manager-only navigation absent', async () => {
    setRows('member', true);
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={adviserId} />);
    const nav = await screen.findByRole('navigation', { name: 'Employment support areas' });
    expect(within(nav).getByRole('button', { name: 'My caseload' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('button', { name: 'My team' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Settings' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'My caseload' })).toBeVisible();
    await navigateHub('Employers');
    expect(screen.queryByRole('heading', { name: 'My caseload' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Employers and contacts' })).toBeVisible();
    fireEvent.click(screen.getByText('Find employers', { selector: 'summary' }));
    expect(screen.queryByText('Manager setup details')).toBeNull();
    expect(screen.queryByText(/COMPANIES_HOUSE_API_KEY/)).toBeNull();
  });

  it('does not download a caseload after the manager leaves that area', async () => {
    setupEsOverview();
    await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export caseload' }));
    let release!: () => void;
    mocks.readGate = new Promise<void>((resolve) => { release = resolve; });
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    await navigateHub('Employers');
    release(); mocks.readGate = null;
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export caseload', hidden: true })).toBeEnabled());
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('restores an uncertain employer request into its visible workspace after refresh', async () => {
    setRows('owner');
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('network unavailable') });
    const first = await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'Employers');
    fireEvent.click(screen.getByText('Employer outreach', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Programme offer for employer outreach'), { target: { value: 'We help local employers with candidate introductions and recruitment.' } });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE PROGRAMME OFFER' }));
    await screen.findByRole('button', { name: 'Retry exact saved change' });
    const original = mocks.invoke.mock.calls[0][1].body;
    first.unmount();
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const retry = await screen.findByRole('button', { name: 'Retry exact saved change' });
    expect(retry).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Employment support areas' });
    expect(within(nav).getByRole('button', { name: 'Employers' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Caseload' })).toBeDisabled();
    mocks.invoke.mockResolvedValueOnce({ data: { operation: 'outreach_settings', recordId: savedId, workspaceId, programmeId, version: 1, duplicate: false }, error: null });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls[1][1].body).toEqual(original);
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Caseload' })).toBeEnabled());
  });

  it('uses authorised staff display names in the ES workspace and caseload assignment controls', async () => {
    setupEsOverview();
    mocks.rpc.mockImplementation(async (name: string, input: { target_workspace_id: string }) => ({ data: name === 'list_rev_workspace_staff_names' ? [{ userId: ownerId, displayName: 'Michael Blackwood' }, { userId: adviserId, displayName: 'Jane Specialist' }] : { workspaceId: input.target_workspace_id, members: [], invitations: [] }, error: null }));
    render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const list = await screen.findByLabelText('Programme Employment Specialists');
    expect(within(list).getByText('Michael Blackwood (you)')).toBeVisible();
    const jane = within(list).getByText('Jane Specialist').closest('li')!;
    fireEvent.click(within(jane).getByRole('button', { name: 'Open caseload' }));
    expect(screen.getByRole('heading', { name: 'Jane Specialist — caseload' })).toBeVisible();
    expect(within(screen.getByLabelText('Caseload overview')).getByText('Assigned to Jane Specialist')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Export caseload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.download.mock.calls[0][0][0][5]).toBe('Jane Specialist');
  });

  it('keeps an uncertain staff invitation visible and blocks programme and area changes after refresh', async () => {
    setRows('owner');
    const normalRpc = async (name: string, input: { target_workspace_id: string }) => name === 'list_rev_workspace_staff_names' ? { data: [], error: null } : name === 'list_rev_workspace_team' ? { data: { workspaceId: input.target_workspace_id, members: [{ userId: ownerId, role: 'owner', status: 'active', displayName: null, nameVersion: 0 }], invitations: [] }, error: null } : { data: null, error: { code: 'FETCH_ERROR' } };
    mocks.rpc.mockImplementation(normalRpc);
    const first = await renderHub(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />, 'My team');
    fireEvent.click(screen.getByText('Invite or manage staff'));
    fireEvent.change(await screen.findByLabelText('Staff name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Staff email'), { target: { value: 'jane@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation link' }));
    expect(await screen.findByRole('button', { name: 'Retry same team change' })).toBeVisible();
    const original = mocks.rpc.mock.calls.find(([name]) => name === 'manage_rev_workspace_team')?.[1];
    first.unmount(); render(<ProgrammeHubModule workspaceId={workspaceId} userId={ownerId} />);
    const retry = await screen.findByRole('button', { name: 'Retry same team change' });
    await waitFor(() => {
      expect(retry).toBeVisible();
      expect(screen.getByLabelText('Choose a programme')).toBeDisabled();
    });
    const nav = screen.getByRole('navigation', { name: 'Employment support areas' });
    expect(within(nav).getByRole('button', { name: 'Employers' })).toBeDisabled();
    mocks.rpc.mockImplementation(async (name: string, input: { target_workspace_id: string }) => name === 'manage_rev_workspace_team' ? { data: { operation: 'invite', workspaceId, invitationId: savedId }, error: null } : normalRpc(name, input));
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.rpc.mock.calls.filter(([name]) => name === 'manage_rev_workspace_team')).toHaveLength(2));
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'manage_rev_workspace_team')[1][1]).toEqual(original);
    expect(await screen.findByLabelText('Invitation link')).toBeVisible();
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Employers' })).toBeEnabled());
  });

});
