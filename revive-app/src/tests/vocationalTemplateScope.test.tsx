// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VocationalProfileBuilder from '@/components/VocationalProfileBuilder';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), published: false }));
vi.mock('@/data/supabaseClient', () => ({ supabaseClient: {
  rpc: (...args: unknown[]) => mocks.rpc(...args),
  from: () => {
    let programme = '';
    const query = {
      select: () => query,
      eq: (column: string, value: string) => { if (column === 'programme_id') programme = value; return query; },
      is: () => query, order: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{
        id: `template-${programme}`, programme_id: programme, title: `Template ${programme}`,
        status: mocks.published ? 'published' : 'draft', version: 1,
        sections: [{ id: 'section', title: 'Employment goals', questions: [] }],
      }], error: null }).then(resolve),
    };
    return query;
  },
} }));
const props = { workspaceId: 'workspace', userId: 'user', programmeId: 'alice' };
function deferred() {
  let resolve!: (value: { data: unknown; error: Error | null }) => void;
  const promise = new Promise<{ data: unknown; error: Error | null }>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  mocks.rpc.mockReset(); mocks.published = false; window.sessionStorage.clear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('vocational template scope', () => {
  it('does not apply a previous programme save to the current template or clear its pending recovery', async () => {
    const pending = deferred(); mocks.rpc.mockReturnValue(pending.promise);
    const view = render(<VocationalProfileBuilder {...props} />);
    const title = await screen.findByLabelText('Template title');
    fireEvent.change(title, { target: { value: 'Alice edited template' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    view.rerender(<VocationalProfileBuilder {...props} programmeId="bob" />);
    const bobTitle = await screen.findByLabelText('Template title');
    expect(bobTitle).toHaveValue('Template bob');
    await act(async () => pending.resolve({ data: { id: 'template-alice', version: 2, status: 'draft' }, error: null }));
    expect(bobTitle).toHaveValue('Template bob');
    expect(screen.queryByText('Draft saved.')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('rev-vocational-pending:workspace:alice:user')).not.toBeNull();
    fireEvent.change(bobTitle, { target: { value: 'Bob edited template' } });
    expect(bobTitle).toHaveValue('Bob edited template');
  });

  it('does not apply a previous publication to another programme', async () => {
    const pending = deferred(); mocks.rpc.mockReturnValue(pending.promise);
    const view = render(<VocationalProfileBuilder {...props} />);
    await screen.findByLabelText('Template title');
    fireEvent.click(screen.getByRole('button', { name: 'Publish template' }));
    view.rerender(<VocationalProfileBuilder {...props} programmeId="bob" />);
    const bobTitle = await screen.findByLabelText('Template title');
    await act(async () => pending.resolve({ data: { id: 'template-alice', status: 'published' }, error: null }));
    expect(bobTitle).toBeEnabled();
    expect(screen.queryByText('Template published.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not apply an old revision to the new programme', async () => {
    mocks.published = true;
    const pending = deferred(); mocks.rpc.mockReturnValue(pending.promise);
    const view = render(<VocationalProfileBuilder {...props} />);
    await screen.findByLabelText('Template title');
    fireEvent.click(screen.getByRole('button', { name: 'Create editable draft version' }));
    view.rerender(<VocationalProfileBuilder {...props} programmeId="bob" />);
    const bobTitle = await screen.findByLabelText('Template title');
    await act(async () => pending.resolve({ data: { id: 'alice-revision', status: 'draft', version: 2 }, error: null }));
    expect(bobTitle).toHaveValue('Template bob');
    expect(bobTitle).toBeDisabled();
    expect(screen.queryByText('Editable draft created. Published version retained.')).not.toBeInTheDocument();
  });

  it('resets busy state for a new programme and ignores an old failure', async () => {
    const pending = deferred(); mocks.rpc.mockReturnValue(pending.promise);
    const view = render(<VocationalProfileBuilder {...props} />);
    fireEvent.change(await screen.findByLabelText('Template title'), { target: { value: 'Alice edited template' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    view.rerender(<VocationalProfileBuilder {...props} programmeId="bob" />);
    const bobTitle = await screen.findByLabelText('Template title');
    expect(bobTitle).toBeEnabled();
    await act(async () => pending.resolve({ data: null, error: new Error('Old scope failure') }));
    expect(screen.queryByText('Save not confirmed. Retry the same save before making further changes.')).not.toBeInTheDocument();
    expect(bobTitle).toBeEnabled();
  });

  it('blocks new writes when retained-save recovery cannot be read', async () => {
    window.sessionStorage.setItem('rev-vocational-pending:workspace:alice:user', '{invalid-json');
    render(<VocationalProfileBuilder {...props} />);
    const title = await screen.findByLabelText('Template title');
    expect(title).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publish template' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Pending save recovery is unavailable');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('rev-vocational-pending:workspace:alice:user')).toBe('{invalid-json');
  });
});
