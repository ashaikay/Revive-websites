// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParticipantVocationalAssessment } from '@/components/ParticipantVocationalAssessment';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/data/supabaseClient', () => ({ supabaseClient: {
  rpc: (...args: unknown[]) => mocks.rpc(...args),
  from: (table: string) => {
    const rows = table === 'programme_hub_vocational_templates' ? [{ id: 'template' }] : [{
      id: 'snapshot', template_id: 'template', version: 1, title: 'Core questionnaire',
      sections: [{ id: 'goals', title: 'Employment goals', questions: [{
        id: 'role', label: 'Preferred role', type: 'short_text', required: false, sensitive: false,
      }] }], published_at: '2026-10-01T09:00:00Z',
    }];
    const query = {
      select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return query;
  },
} }));
vi.mock('@/components/VocationalStatusPanel', () => ({ VocationalStatusPanel: () => null }));

type Result = { data: unknown; error: Error | null };
function deferred() {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((done) => { resolve = done; });
  return { promise, resolve };
}
const props = { workspaceId: 'workspace', programmeId: 'programme', participantId: 'alice', participantName: 'Alice', caseReference: 'CASE-001' };
const assessment = (participant: string, answers = { role: `Saved ${participant}` }) => ({ assessmentId: `assessment-${participant}`, version: 1, status: 'in_progress', answers });

async function openProfile() {
  fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));
  await screen.findByRole('button', { name: 'Mark completed' });
  fireEvent.click(screen.getByRole('button', { name: /Employment goals/ }));
  return screen.getByLabelText('Preferred role');
}
beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation((_name, args) => Promise.resolve({ data: assessment(args.target_participant_id), error: null }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('vocational assessment writes', () => {
  it('locks answer fields and closing while a save is pending, then unlocks after confirmation', async () => {
    const pending = deferred();
    render(<StrictMode><ParticipantVocationalAssessment {...props} /></StrictMode>);
    const input = await openProfile();
    fireEvent.change(input, { target: { value: 'Warehouse' } });
    mocks.rpc.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close profile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeDisabled();
    await act(async () => pending.resolve({ data: assessment('alice', { role: 'Warehouse' }), error: null }));
    expect(input).toBeEnabled();
    expect(input).toHaveValue('Warehouse');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('retains unsaved answers and unlocks the form when a save fails', async () => {
    const pending = deferred();
    render(<ParticipantVocationalAssessment {...props} />);
    const input = await openProfile();
    fireEvent.change(input, { target: { value: 'Warehouse' } });
    mocks.rpc.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    await act(async () => pending.resolve({ data: null, error: new Error('Save refused') }));
    expect(input).toBeEnabled();
    expect(input).toHaveValue('Warehouse');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Save refused');
  });

  it('does not apply a previous participant save to the newly opened participant', async () => {
    const pending = deferred();
    const view = render(<ParticipantVocationalAssessment {...props} />);
    const input = await openProfile();
    fireEvent.change(input, { target: { value: 'Alice private draft' } });
    mocks.rpc.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    view.rerender(<ParticipantVocationalAssessment {...props} participantId="bob" participantName="Bob" />);
    const bobInput = await openProfile();
    expect(bobInput).toHaveValue('Saved bob');
    await act(async () => pending.resolve({ data: assessment('alice', { role: 'Alice private draft' }), error: null }));
    expect(bobInput).toHaveValue('Saved bob');
    expect(screen.queryByText('Draft saved. You can return to this assessment later.')).not.toBeInTheDocument();
  });

  it('locks answers during completion and keeps the confirmed assessment read-only', async () => {
    const pending = deferred();
    render(<ParticipantVocationalAssessment {...props} />);
    const input = await openProfile();
    mocks.rpc.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Mark completed' }));
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close profile' })).toBeDisabled();
    await act(async () => pending.resolve({ data: { status: 'completed', version: 2 }, error: null }));
    expect(input).toBeDisabled();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save progress' })).not.toBeInTheDocument());
  });

  it('does not let an old save failure clear a new participant save or display its error', async () => {
    const aliceSave = deferred(), bobSave = deferred();
    const view = render(<ParticipantVocationalAssessment {...props} />);
    fireEvent.change(await openProfile(), { target: { value: 'Alice draft' } });
    mocks.rpc.mockReturnValueOnce(aliceSave.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    view.rerender(<ParticipantVocationalAssessment {...props} participantId="bob" participantName="Bob" />);
    const bobInput = await openProfile();
    fireEvent.change(bobInput, { target: { value: 'Bob draft' } });
    mocks.rpc.mockReturnValueOnce(bobSave.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    await act(async () => aliceSave.resolve({ data: null, error: new Error('Alice save failed') }));
    expect(bobInput).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => bobSave.resolve({ data: assessment('bob', { role: 'Bob draft' }), error: null }));
    expect(bobInput).toBeEnabled();
    expect(bobInput).toHaveValue('Bob draft');
  });

  it('does not mark a new participant completed when a previous completion returns', async () => {
    const pending = deferred();
    const view = render(<ParticipantVocationalAssessment {...props} />);
    await openProfile();
    mocks.rpc.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Mark completed' }));
    view.rerender(<ParticipantVocationalAssessment {...props} participantId="bob" participantName="Bob" />);
    const bobInput = await openProfile();
    await act(async () => pending.resolve({ data: { status: 'completed', version: 2 }, error: null }));
    expect(bobInput).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeEnabled();
    expect(screen.queryByText('Vocational assessment marked completed.')).not.toBeInTheDocument();
  });

  it('renders readable participant references and progress punctuation', async () => {
    const view = render(<ParticipantVocationalAssessment {...props} />);
    expect(screen.getByText('Alice · CASE-001')).toBeInTheDocument();
    await openProfile();
    expect(view.container.textContent).not.toMatch(/Â·|âˆ’/);
    expect(screen.getByText('Core vocational profile: 100% · 0 unanswered · 0 required')).toBeInTheDocument();
  });

  it('ignores an old save even after navigating away and back to the same participant', async () => {
    const pending = deferred();
    const view = render(<ParticipantVocationalAssessment {...props} />);
    fireEvent.change(await openProfile(), { target: { value: 'Outdated Alice draft' } });
    mocks.rpc.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    view.rerender(<ParticipantVocationalAssessment {...props} participantId="bob" participantName="Bob" />);
    await openProfile();
    view.rerender(<ParticipantVocationalAssessment {...props} />);
    const currentInput = await openProfile();
    expect(currentInput).toHaveValue('Saved alice');
    await act(async () => pending.resolve({ data: assessment('alice', { role: 'Outdated Alice draft' }), error: null }));
    expect(currentInput).toHaveValue('Saved alice');
    expect(screen.queryByText('Draft saved. You can return to this assessment later.')).not.toBeInTheDocument();
  });
});
