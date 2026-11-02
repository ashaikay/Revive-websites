// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParticipantActionPlan, type ActionPlanRead } from '@/components/ParticipantActionPlan';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/data/supabaseClient', () => ({ supabaseClient: { rpc: (...args: unknown[]) => mocks.rpc(...args) } }));

const v1 = { templateVersionId: 'v1', title: 'Employment questionnaire', version: 1 };
const v2 = { templateVersionId: 'v2', title: 'Employment questionnaire 2026', version: 2 };
const empty: ActionPlanRead = { plan: null, revisions: [], currentQuestionnaire: v1, reviewNeeded: false, assignedSpecialistIds: ['es-1'] };
const action = (overrides = {}) => ({ id: '11111111-1111-4111-8111-111111111111', description: 'Update CV', ownerType: 'employment_specialist' as const, ownerUserId: 'es-1', status: 'in_progress' as const, targetDate: '2026-11-20', ...overrides });
const revision = (number: number, goal: string, overrides = {}) => ({ revision: number, employmentGoal: goal, actions: [action()], templateVersionId: 'v1', questionnaireTitle: v1.title, questionnaireVersion: 1, savedByUserId: 'es-1', savedAt: '2026-11-01T10:00:00Z', ...overrides });
const props = { workspaceId: 'workspace', programmeId: 'programme', participantId: 'alice', assignableSpecialists: [{ userId: 'es-1', label: 'Robert ES' }, { userId: 'es-2', label: 'Other ES' }], staffLabel: (id: string) => ({ 'es-1': 'Robert ES', 'es-2': 'Former ES' }[id] ?? 'Staff member') };

let reads: ActionPlanRead[];
function respond(saveImpl: (args: Record<string, unknown>) => unknown) {
  mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === 'rev_action_plan_read') return Promise.resolve({ data: reads.length > 1 ? reads.shift() : reads[0], error: null });
    return Promise.resolve(saveImpl(args));
  });
}
async function openPlan() {
  fireEvent.click(screen.getByRole('button', { name: 'Open action plan' }));
  return screen.findByLabelText('Employment goal');
}
const saveCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === 'rev_action_plan_save').map(([, args]) => args as Record<string, unknown>);

beforeEach(() => { mocks.rpc.mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('employment action plan', () => {
  it('records a goal and owned action linked to the current questionnaire without claiming agreement', async () => {
    reads = [empty, { ...empty, plan: { planId: 'plan', currentRevision: 1, updatedAt: '2026-11-02T10:00:00Z' }, revisions: [revision(1, 'Warehouse role')] }];
    respond(() => ({ data: { revision: 1, templateVersionId: 'v1' }, error: null }));
    render(<ParticipantActionPlan {...props} />);
    const goal = await openPlan();
    expect(screen.getByText(/does not record the Service user's agreement/)).toBeInTheDocument();
    expect(screen.queryByText(/agreed/i)).not.toBeInTheDocument();
    fireEvent.change(goal, { target: { value: 'Warehouse role' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }));
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'Update CV' } });
    const owner = screen.getByLabelText('Responsible for this action');
    expect(within(owner).getAllByRole('option').map((option) => option.textContent)).toEqual(['Service user', 'Assigned Employment Specialist: Robert ES']);
    fireEvent.change(owner, { target: { value: 'es-1' } });
    fireEvent.change(screen.getByLabelText('Target date (optional)'), { target: { value: '2026-11-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    expect(await screen.findByText('Revision 1 saved. Earlier revisions are kept unchanged.')).toBeInTheDocument();
    const [call] = saveCalls();
    expect(call).toMatchObject({ expected_revision: 0, target_template_version_id: 'v1', target_goal: 'Warehouse role' });
    expect(call.target_actions).toEqual([expect.objectContaining({ description: 'Update CV', ownerType: 'employment_specialist', ownerUserId: 'es-1', status: 'not_started', targetDate: '2026-11-20' })]);
    expect(Object.keys((call.target_actions as object[])[0]).sort()).toEqual(['description', 'id', 'ownerType', 'ownerUserId', 'status', 'targetDate']);
  });

  it('retries an unconfirmed save with the same request ID and a new ID after editing', async () => {
    const saved = { plan: { planId: 'plan', currentRevision: 1, updatedAt: '' }, revisions: [revision(1, 'Warehouse role')] };
    reads = [{ ...empty, ...saved }];
    let attempt = 0;
    respond(() => (++attempt === 1 ? { data: null, error: new Error('Network failure') } : { data: { revision: 2, templateVersionId: 'v1' }, error: null }));
    render(<ParticipantActionPlan {...props} />);
    const goal = await openPlan();
    fireEvent.change(goal, { target: { value: 'Logistics role' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save not confirmed. Your edits remain on screen.');
    expect(goal).toHaveValue('Logistics role');
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    await screen.findByText('Revision 2 saved. Earlier revisions are kept unchanged.');
    const [first, second] = saveCalls();
    expect(second.target_request_id).toBe(first.target_request_id);
    expect(second.expected_revision).toBe(1);

    attempt = 0;
    fireEvent.change(goal, { target: { value: 'Logistics role soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    await screen.findByRole('alert');
    fireEvent.change(goal, { target: { value: 'Logistics role this year' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    await screen.findByText('Revision 2 saved. Earlier revisions are kept unchanged.');
    const [, , third, fourth] = saveCalls();
    expect(fourth.target_request_id).not.toBe(third.target_request_id);
  });

  it('flags review for a newer questionnaire and keeps the existing link unless the reviewer chooses otherwise', async () => {
    reads = [{ plan: { planId: 'plan', currentRevision: 1, updatedAt: '' }, revisions: [revision(1, 'Warehouse role')], currentQuestionnaire: v2, reviewNeeded: true, assignedSpecialistIds: ['es-1'] }];
    respond(() => ({ data: null, error: Object.assign(new Error('pending'), { code: '40001' }) }));
    render(<ParticipantActionPlan {...props} />);
    const goal = await openPlan();
    expect(goal).toHaveValue('Warehouse role');
    expect(screen.getByText('Review needed')).toBeInTheDocument();
    expect(screen.getByText(/Employment questionnaire 2026 - version 2\) has been published since this plan was saved\. The plan and its history are unchanged\./)).toBeInTheDocument();
    expect(screen.getByText('Linked questionnaire: Employment questionnaire - version 1')).toBeInTheDocument();
    fireEvent.change(goal, { target: { value: 'Warehouse role soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByLabelText(/Link the next revision to the current questionnaire/));
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    await act(async () => {});
    expect(saveCalls().map((call) => call.target_template_version_id)).toEqual(['v1', 'v2']);
  });

  it('flags an unassigned ES owner without replacing them and shows earlier revisions read-only', async () => {
    reads = [{ plan: { planId: 'plan', currentRevision: 2, updatedAt: '' }, revisions: [
      revision(2, 'Logistics role', { actions: [action({ ownerUserId: 'es-2', ownerNeedsReview: true })] }),
      revision(1, 'Warehouse role', { savedAt: '2026-10-01T10:00:00Z' }),
    ], currentQuestionnaire: v1, reviewNeeded: false, assignedSpecialistIds: ['es-1'] }];
    respond(() => ({ data: { revision: 3, templateVersionId: 'v1' }, error: null }));
    render(<ParticipantActionPlan {...props} />);
    await openPlan();
    expect(screen.getByText(/Owner needs review: Former ES is no longer assigned to this Service user\. The recorded owner has not been changed\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Responsible for this action')).toHaveValue('es-2');
    fireEvent.click(screen.getByText('Revision history (2)'));
    fireEvent.click(screen.getByRole('button', { name: /^Revision 1 - saved/ }));
    const earlier = screen.getByLabelText('Revision 1 (read-only)');
    expect(within(earlier).getByText('Employment goal: Warehouse role')).toBeInTheDocument();
    expect(within(earlier).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(earlier).queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    await screen.findByText('Revision 3 saved. Earlier revisions are kept unchanged.');
    expect((saveCalls()[0].target_actions as Record<string, unknown>[])[0]).toEqual(expect.objectContaining({ ownerUserId: 'es-2', status: 'completed' }));
    expect((saveCalls()[0].target_actions as Record<string, unknown>[])[0]).not.toHaveProperty('ownerNeedsReview');
  });

  it('does not start a plan without a published questionnaire', async () => {
    reads = [{ ...empty, currentQuestionnaire: null }];
    respond(() => ({ data: null, error: null }));
    render(<ParticipantActionPlan {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open action plan' }));
    expect(await screen.findByText(/A published vocational questionnaire is needed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save revision' })).not.toBeInTheDocument();
  });
});
