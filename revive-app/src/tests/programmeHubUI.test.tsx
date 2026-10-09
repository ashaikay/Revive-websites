// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const adviserId = '33333333-3333-4333-8333-333333333333';
const programmeId = '44444444-4444-4444-8444-444444444444';
const participantId = '55555555-5555-4555-8555-555555555555';
const savedId = '66666666-6666-4666-8666-666666666666';

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  invoke: vi.fn(),
}));

vi.mock('@/data/supabaseClient', () => ({
  supabaseClient: {
    from: (table: string) => ({
      select: () => ({
        eq: async () => ({ data: mocks.rows[table] ?? [], error: null }),
      }),
    }),
    functions: { invoke: mocks.invoke },
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
const setRows = (role: 'owner' | 'member', includeParticipant = false) => {
  mocks.rows = {
    programme_hub_programmes: [programmeRow],
    programme_hub_advisers: role === 'member' ? [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, user_id: adviserId, active: true, version: 1 }] : [],
    programme_hub_employers: [],
    programme_hub_employer_contacts: [],
    programme_hub_vacancies: [],
    programme_hub_participants: includeParticipant ? [participantRow] : [],
    programme_hub_participant_advisers: includeParticipant ? [{ id: savedId, workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, adviser_user_id: adviserId, active: true, version: 1 }] : [],
    programme_hub_contracts: [],
    workspace_members: [{ user_id: role === 'owner' ? ownerId : adviserId, role, status: 'active' }],
  };
};

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.invoke.mockReset();
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
    for (const heading of ['Advisers and caseload', 'Employers', 'Employer contacts', 'Vacancies', 'Participant employment profiles']) {
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
    fireEvent.change(within(section).getByLabelText('Employer key'), { target: { value: 'EMP-001' } });
    fireEvent.change(within(section).getByLabelText('Employer name'), { target: { value: 'Tenant Neutral Employer' } });
    fireEvent.change(within(section).getByLabelText('Sector key'), { target: { value: 'tenant-sector' } });
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
    fireEvent.change(within(section).getByLabelText('Employer key'), { target: { value: 'EMP-002' } });
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
    expect(await screen.findByRole('heading', { name: 'My assigned participants' })).toBeVisible();
    expect(screen.getByText(/Alex/)).toBeVisible();
    expect(screen.getByText(/CASE-001/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Advisers and caseload' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Participant employment profiles' })).toBeNull();
    expect(screen.getByText(/Needs review until required eligibility evidence/)).toBeVisible();
  });
});
