// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VocationalConsentManager } from '@/components/VocationalConsentManager';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/data/supabaseClient', () => ({ supabaseClient: { rpc: (...args: unknown[]) => mocks.rpc(...args) } }));
const advisers = [{ userId: 'adviser', label: 'Robert' }];
const status = (id = 'alice', consent = 'none', grants: string[] = []) => ({ data: { assessment_id: id, consent, grants }, error: null });
function mount() { return render(<VocationalConsentManager assessmentId="alice" advisers={advisers} />); }
function fill() {
  fireEvent.change(screen.getByLabelText('Consent/withdrawal evidence reference'), { target: { value: 'Evidence reference' } });
  fireEvent.change(screen.getByLabelText("Participant's recorded consent or withdrawal statement"), { target: { value: 'Participant explicitly agreed to optional support.' } });
}
beforeEach(() => { mocks.rpc.mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('loads current consent, disables grants without consent, and distinguishes an unavailable read', async () => {
  mocks.rpc.mockResolvedValueOnce(status()); mount();
  await screen.findByText('Participant consent: Not recorded.');
  expect(screen.getByRole('button', { name: 'Record consent' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Assigned adviser'), { target: { value: 'adviser' } });
  expect(screen.getByRole('button', { name: 'Grant access' })).toBeDisabled();
  mocks.rpc.mockResolvedValueOnce({ error: { code: '42501' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check current permissions' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Record consent' })).toBeDisabled();
  expect(screen.queryByText('Participant consent: Not recorded.')).not.toBeInTheDocument();
});
it('blocks duplicate grants and allows revoking existing grants including former advisers', async () => {
  mocks.rpc.mockResolvedValue(status('alice', 'granted', ['adviser', 'former'])); mount();
  await screen.findByText('Participant consent: granted.');
  fireEvent.change(screen.getByLabelText('Assigned adviser'), { target: { value: 'adviser' } });
  expect(screen.getByRole('button', { name: 'Grant access' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Revoke access' })).toBeEnabled();
  expect(screen.getByRole('option', { name: 'Previously assigned adviser' })).toBeInTheDocument();
});
it('keeps uncertain writes blocked until a fresh status read, without replaying the write', async () => {
  mocks.rpc.mockResolvedValueOnce(status()).mockRejectedValueOnce(new Error('Network'));
  mount(); await screen.findByText('Participant consent: Not recorded.'); fill();
  fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Record consent' })).toBeDisabled();
  expect(screen.getByLabelText('Consent/withdrawal evidence reference')).toHaveValue('Evidence reference');
  mocks.rpc.mockResolvedValueOnce(status('alice', 'granted'));
  fireEvent.click(screen.getByRole('button', { name: 'Check current permissions' }));
  await screen.findByText('Participant consent: granted.');
  expect(mocks.rpc.mock.calls.filter(c => c[0] === 'rev_voc_support_consent_record')).toHaveLength(1);
});
it('locks fields during writes and requires a fresh permission check after success', async () => {
  let done!: (value: unknown) => void;
  mocks.rpc.mockResolvedValueOnce(status()).mockReturnValueOnce(new Promise(r => { done = r; }));
  mount(); await screen.findByText('Participant consent: Not recorded.'); fill();
  fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));
  expect(screen.getByLabelText('Consent/withdrawal evidence reference')).toBeDisabled();
  await act(async () => done({ error: null }));
  expect(screen.getByText('Consent recorded by the server.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record consent' })).toBeDisabled();
});
it('suppresses old scope reads and rejects mismatched assessment results', async () => {
  let done!: (value: unknown) => void;
  mocks.rpc.mockReturnValueOnce(new Promise(r => { done = r; })).mockResolvedValueOnce(status('bob', 'withdrawn'));
  const view = mount(); view.rerender(<VocationalConsentManager assessmentId="bob" advisers={advisers} />);
  await screen.findByText('Participant consent: withdrawn.');
  await act(async () => done(status('alice', 'granted')));
  expect(screen.queryByText('Participant consent: granted.')).not.toBeInTheDocument();
  mocks.rpc.mockResolvedValueOnce(status('alice'));
  fireEvent.click(screen.getByRole('button', { name: 'Check current permissions' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Record consent' })).toBeDisabled();
});
it('does not let an old write clear the new assessment form or unlock its pending write', async () => {
  let aliceDone!: (value: unknown) => void, bobDone!: (value: unknown) => void;
  mocks.rpc.mockImplementation((name: string, args: { p_assessment_id: string }) => name === 'rev_voc_support_access_status'
    ? Promise.resolve(status(args.p_assessment_id))
    : new Promise(r => { if (args.p_assessment_id === 'alice') aliceDone = r; else bobDone = r; }));
  const view = mount(); await screen.findByText('Participant consent: Not recorded.'); fill();
  fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));
  view.rerender(<VocationalConsentManager assessmentId="bob" advisers={advisers} />);
  await screen.findByText('Participant consent: Not recorded.'); fill();
  fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));
  await act(async () => aliceDone({ error: null }));
  expect(screen.getByLabelText('Consent/withdrawal evidence reference')).toHaveValue('Evidence reference');
  expect(screen.getByRole('button', { name: 'Check current permissions' })).toBeDisabled();
  await act(async () => bobDone({ error: null }));
  expect(screen.getByText('Consent recorded by the server.')).toBeInTheDocument();
});
