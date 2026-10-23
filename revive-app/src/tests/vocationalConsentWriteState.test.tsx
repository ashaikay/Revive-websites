// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VocationalConsentManager } from '@/components/VocationalConsentManager';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/data/supabaseClient', () => ({ supabaseClient: { rpc: (...args: unknown[]) => mocks.rpc(...args) } }));
const advisers = [{ userId: 'adviser', label: 'Assigned adviser' }];
function deferred() {
  let resolve!: (value: { error: Error | null }) => void;
  const promise = new Promise<{ error: Error | null }>((done) => { resolve = done; });
  return { promise, resolve };
}
function fill(evidence = 'Evidence reference', statement = 'Participant explicitly agreed to optional support.') {
  fireEvent.change(screen.getByLabelText('Consent/withdrawal evidence reference'), { target: { value: evidence } });
  fireEvent.change(screen.getByLabelText("Participant's recorded consent or withdrawal statement"), { target: { value: statement } });
}
function open() { fireEvent.click(screen.getByText('Optional support — consent and adviser permissions (managers)')); }
beforeEach(() => { mocks.rpc.mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('consent write state', () => {
  it('locks all evidence and adviser fields during a pending operation', async () => {
    const pending = deferred(); mocks.rpc.mockReturnValue(pending.promise);
    render(<VocationalConsentManager assessmentId="alice" advisers={advisers} />); open(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    expect(screen.getByLabelText('Consent/withdrawal evidence reference')).toBeDisabled();
    expect(screen.getByLabelText("Participant's recorded consent or withdrawal statement")).toBeDisabled();
    expect(screen.getByLabelText('Assigned adviser')).toBeDisabled();
    expect(screen.getByLabelText('Purpose of restricted support access')).toBeDisabled();
    await act(async () => pending.resolve({ error: null }));
    expect(screen.getByLabelText('Consent/withdrawal evidence reference')).toBeEnabled();
    expect(screen.getByLabelText('Consent/withdrawal evidence reference')).toHaveValue('');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('keeps evidence available when the server refuses the operation', async () => {
    mocks.rpc.mockResolvedValue({ error: new Error('Consent refused') });
    render(<VocationalConsentManager assessmentId="alice" advisers={advisers} />); open(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Consent refused');
    expect(screen.getByLabelText('Consent/withdrawal evidence reference')).toHaveValue('Evidence reference');
    expect(screen.getByRole('button', { name: 'Record consent' })).toBeEnabled();
  });

  it('ignores the old assessment success while a new consent request is pending', async () => {
    const alice = deferred(), bob = deferred();
    mocks.rpc.mockReturnValueOnce(alice.promise).mockReturnValueOnce(bob.promise);
    const view = render(<VocationalConsentManager assessmentId="alice" advisers={advisers} />); open(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    view.rerender(<VocationalConsentManager assessmentId="bob" advisers={advisers} />);
    fill('Bob evidence reference');
    fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    await act(async () => alice.resolve({ error: null }));
    expect(screen.getByLabelText('Consent/withdrawal evidence reference')).toHaveValue('Bob evidence reference');
    expect(screen.getByRole('button', { name: 'Record consent' })).toBeDisabled();
    expect(screen.queryByText('Consent recorded by the server.')).not.toBeInTheDocument();
    await act(async () => bob.resolve({ error: null }));
    expect(screen.getByText('Consent recorded by the server.')).toBeInTheDocument();
    expect(mocks.rpc.mock.calls[1][1].p_assessment_id).toBe('bob');
  });

  it('does not show an old failure under another assessment', async () => {
    const pending = deferred(); mocks.rpc.mockReturnValue(pending.promise);
    const view = render(<VocationalConsentManager assessmentId="alice" advisers={advisers} />); open(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    view.rerender(<VocationalConsentManager assessmentId="bob" advisers={advisers} />);
    fill('Bob evidence reference');
    await act(async () => pending.resolve({ error: new Error('Alice-only failure') }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Consent/withdrawal evidence reference')).toHaveValue('Bob evidence reference');
  });

  it('requires evidence and confirmation for withdrawals and sends the reviewed assessment', async () => {
    mocks.rpc.mockResolvedValue({ error: null });
    render(<VocationalConsentManager assessmentId="alice" advisers={advisers} />); open();
    fireEvent.click(screen.getByRole('button', { name: 'Record withdrawal' }));
    expect(mocks.rpc).not.toHaveBeenCalled();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Record withdrawal' }));
    await screen.findByText('Consent withdrawal recorded; restricted access is blocked.');
    expect(window.confirm).toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('rev_voc_support_consent_withdraw', expect.objectContaining({ p_assessment_id: 'alice' }));
  });
});
