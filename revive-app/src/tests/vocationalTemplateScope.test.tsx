// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VocationalProfileBuilder from '@/components/VocationalProfileBuilder';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), published: false, supportOnly: false, version: 1, queryIds: [] as string[] }));
vi.mock('@/data/supabaseClient', () => ({ supabaseClient: {
  rpc: (...args: unknown[]) => mocks.rpc(...args),
  from: () => {
    let programme = ''; let requestedId = '';
    const query = {
      select: () => query,
      eq: (column: string, value: string) => { if (column === 'programme_id') programme = value; if (column === 'id') { requestedId = value; mocks.queryIds.push(value); } return query; },
      is: () => query, order: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{
        id: requestedId || `template-${programme}`, programme_id: programme, title: `Template ${programme}`,
        status: mocks.published ? 'published' : 'draft', version: mocks.version,
        sections: [{ id: 'section', title: mocks.supportOnly ? 'Criminal Justice and Resettlement Support' : 'Employment goals', questions: [{id:'question',sectionId:'section',label:'What work interests you?',type:'long_text',required:false,sensitive:false,order:0}] }],
      }], error: null }).then(resolve),
    };
    return query;
  },
} }));
const props = { workspaceId: 'workspace', userId: 'user', programmeId: 'alice' };
function advanced(name: string) {
  const summary = screen.getByText('More options', {selector:'summary'});
  if (!summary.closest('details')?.open) fireEvent.click(summary);
  return screen.getByRole('button',{name});
}

function deferred() {
  let resolve!: (value: { data: unknown; error: Error | null }) => void;
  const promise = new Promise<{ data: unknown; error: Error | null }>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  mocks.rpc.mockReset(); mocks.published = false; mocks.supportOnly = false; mocks.version = 1; mocks.queryIds = []; window.sessionStorage.clear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('vocational template scope', () => {
  it('does not apply a previous programme save to the current template or clear its pending recovery', async () => {
    const pending = deferred(); mocks.rpc.mockReturnValue(pending.promise);
    const view = render(<VocationalProfileBuilder {...props} />);
    const title = await screen.findByLabelText('Questionnaire name');
    fireEvent.change(title, { target: { value: 'Alice edited template' } });
    fireEvent.click(advanced('Save draft'));
    view.rerender(<VocationalProfileBuilder {...props} programmeId="bob" />);
    const bobTitle = await screen.findByLabelText('Questionnaire name');
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
    await screen.findByLabelText('Questionnaire name');
    fireEvent.click(advanced('Publish template'));
    view.rerender(<VocationalProfileBuilder {...props} programmeId="bob" />);
    const bobTitle = await screen.findByLabelText('Questionnaire name');
    await act(async () => pending.resolve({ data: { id: 'template-alice', status: 'published' }, error: null }));
    expect(bobTitle).toBeEnabled();
    expect(screen.queryByText('Template published.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not apply an old revision to the new programme', async () => {
    mocks.published = true;
    const pending = deferred(); mocks.rpc.mockReturnValue(pending.promise);
    const view = render(<VocationalProfileBuilder {...props} />);
    await screen.findByLabelText('Questionnaire name');
    fireEvent.click(screen.getByRole('button', { name: 'Edit questionnaire' }));
    view.rerender(<VocationalProfileBuilder {...props} programmeId="bob" />);
    const bobTitle = await screen.findByLabelText('Questionnaire name');
    await act(async () => pending.resolve({ data: { id: 'alice-revision', status: 'draft', version: 2 }, error: null }));
    expect(bobTitle).toHaveValue('Template bob');
    expect(bobTitle).toBeDisabled();
    expect(screen.queryByText(/Ready to edit/)).not.toBeInTheDocument();
  });

  it('resets busy state for a new programme and ignores an old failure', async () => {
    const pending = deferred(); mocks.rpc.mockReturnValue(pending.promise);
    const view = render(<VocationalProfileBuilder {...props} />);
    fireEvent.change(await screen.findByLabelText('Questionnaire name'), { target: { value: 'Alice edited template' } });
    fireEvent.click(advanced('Save draft'));
    view.rerender(<VocationalProfileBuilder {...props} programmeId="bob" />);
    const bobTitle = await screen.findByLabelText('Questionnaire name');
    expect(bobTitle).toBeEnabled();
    await act(async () => pending.resolve({ data: null, error: new Error('Old scope failure') }));
    expect(screen.queryByText('Save not confirmed. Retry the same save before making further changes.')).not.toBeInTheDocument();
    expect(bobTitle).toBeEnabled();
  });

  it('blocks new writes when retained-save recovery cannot be read', async () => {
    window.sessionStorage.setItem('rev-vocational-pending:workspace:alice:user', '{invalid-json');
    render(<VocationalProfileBuilder {...props} />);
    const title = await screen.findByLabelText('Questionnaire name');
    expect(title).toBeDisabled();
    expect(advanced('Publish template')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Pending save recovery is unavailable');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('rev-vocational-pending:workspace:alice:user')).toBe('{invalid-json');
  });
});


it('blocks publication of optional-only questionnaires and explains how managers can repair them', async()=>{
  mocks.supportOnly=true;render(<VocationalProfileBuilder {...props}/>);
  await screen.findByLabelText('Questionnaire name');
  expect(advanced('Publish template')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('no core employment questions');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('creates a reviewed revision with core questions while preserving the published version', async()=>{
  mocks.supportOnly=true;mocks.published=true;
  mocks.rpc.mockImplementation(async(name)=>({data:name==='rev_vocational_create_revision'?{id:'revision',version:2,status:'draft'}:
    name==='save_rev_vocational_template'?{id:'revision',version:3,status:'draft'}:{id:'revision',status:'published'},error:null}));
  render(<VocationalProfileBuilder {...props}/>);
  await screen.findByLabelText('Questionnaire name');
  fireEvent.click(screen.getByRole('button',{name:'Edit questionnaire'}));
  expect(await screen.findByText(/Ready to edit/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Add suggested questions'}));
  expect(screen.getByText('Core starter questions are already present.')).toBeVisible();
  fireEvent.click(advanced('Save draft'));
  await screen.findByText('Draft saved.');
  const saved=mocks.rpc.mock.calls.find(([name])=>name==='save_rev_vocational_template')![1];
  expect(saved.target_template_id).toBe('revision');
  expect(saved.target_sections[0].title).toBe('Criminal Justice and Resettlement Support');
  expect(saved.target_sections[0].questions).toHaveLength(1);
  fireEvent.click(advanced('Publish template'));
  expect(await screen.findByText('Template published.')).toBeVisible();
  expect(screen.getByLabelText('Questionnaire action feedback')).toHaveFocus();
});
it('creates a separate unsaved questionnaire after publishing without changing the existing one',async()=>{
  mocks.published=true;render(<VocationalProfileBuilder {...props}/>);
  await screen.findByLabelText('Questionnaire name');
  fireEvent.click(advanced('Create another questionnaire'));
  expect(screen.getByLabelText('Questionnaire name')).toHaveValue('Vocational Profile');
  expect(screen.getByText('New questionnaire ready to edit. Choose Save and make available when ready.')).toBeVisible();
  expect(advanced('Publish template')).toBeDisabled();
  expect(advanced('Save draft')).toBeEnabled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});


it('saves and makes available in one action using the confirmed saved version, with duplicate clicks blocked',async()=>{
  const saving=deferred(), publishing=deferred();
  mocks.rpc.mockImplementation((name:string)=>name==='save_rev_vocational_template'?saving.promise:publishing.promise);
  render(<VocationalProfileBuilder {...props}/>);
  fireEvent.change(await screen.findByLabelText('Questionnaire name'),{target:{value:'Reviewed questionnaire'}});
  const action=screen.getByRole('button',{name:'Save and make available'});
  fireEvent.click(action);fireEvent.click(action);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Questionnaire name')).toBeDisabled();
  expect(screen.getByText('More options',{selector:'summary'}).closest('details')).not.toHaveAttribute('open');
  await act(async()=>saving.resolve({data:{id:'template-alice',version:2,status:'draft'},error:null}));
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(mocks.rpc.mock.calls[1]).toEqual(['publish_rev_vocational_template',{
    target_workspace_id:'workspace',target_template_id:'template-alice',expected_version:2,
  }]);
  expect(screen.getByRole('button',{name:'Saving and making available...'})).toBeDisabled();
  await act(async()=>publishing.resolve({data:{id:'template-alice',status:'published'},error:null}));
  expect(screen.getByText(/Questionnaire is now available to assigned staff/)).toBeVisible();
  expect(screen.getByRole('button',{name:'Edit questionnaire'})).toBeEnabled();
});
it('stops after an uncertain save and retains the exact request rather than making it available',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null,error:new Error('Network outcome unknown')});
  render(<VocationalProfileBuilder {...props}/>);
  fireEvent.change(await screen.findByLabelText('Questionnaire name'),{target:{value:'Reviewed questionnaire'}});
  fireEvent.click(screen.getByRole('button',{name:'Save and make available'}));
  await screen.findByRole('button',{name:'Retry same save'});
  const original=mocks.rpc.mock.calls[0];
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(window.sessionStorage.getItem('rev-vocational-pending:workspace:alice:user')).not.toBeNull();
  mocks.rpc.mockResolvedValueOnce({data:{id:'template-alice',version:2,status:'draft'},error:null});
  fireEvent.click(screen.getByRole('button',{name:'Retry same save'}));
  await screen.findByText('Draft saved.');
  expect(mocks.rpc.mock.calls[1]).toEqual(original);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  mocks.rpc.mockResolvedValueOnce({data:{id:'template-alice',status:'published'},error:null});
  fireEvent.click(screen.getByRole('button',{name:'Save and make available'}));
  await screen.findByText(/Questionnaire is now available to assigned staff/);
  expect(mocks.rpc.mock.calls[2][0]).toBe('publish_rev_vocational_template');
  expect(mocks.rpc).toHaveBeenCalledTimes(3);
});
it('checks the same saved questionnaire after an uncertain publication without resubmitting it',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{id:'template-alice',version:2,status:'draft'},error:null})
    .mockRejectedValueOnce(new Error('Network response lost'));
  render(<VocationalProfileBuilder {...props}/>);
  fireEvent.change(await screen.findByLabelText('Questionnaire name'),{target:{value:'Reviewed questionnaire'}});
  fireEvent.click(screen.getByRole('button',{name:'Save and make available'}));
  const check=await screen.findByRole('button',{name:'Check availability'});
  expect(screen.getByLabelText('Questionnaire name')).toBeDisabled();
  expect(screen.queryByRole('button',{name:'Save and make available'})).toBeNull();
  mocks.published=true;mocks.version=2;
  fireEvent.click(check);
  expect(await screen.findByText('Questionnaire is available to assigned staff.')).toBeVisible();
  expect(mocks.queryIds).toEqual(['template-alice']);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});
it('does not publish an old programme save or clear a new scope after navigation',async()=>{
  const saving=deferred();mocks.rpc.mockReturnValue(saving.promise);
  const view=render(<VocationalProfileBuilder {...props}/>);
  fireEvent.change(await screen.findByLabelText('Questionnaire name'),{target:{value:'Alice changes'}});
  fireEvent.click(screen.getByRole('button',{name:'Save and make available'}));
  view.rerender(<VocationalProfileBuilder {...props} programmeId="bob"/>);
  await screen.findByLabelText('Questionnaire name');
  await act(async()=>saving.resolve({data:{id:'template-alice',version:2,status:'draft'},error:null}));
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Questionnaire name')).toHaveValue('Template bob');
  expect(screen.getByRole('button',{name:'Save and make available'})).toBeEnabled();
  expect(window.sessionStorage.getItem('rev-vocational-pending:workspace:alice:user')).not.toBeNull();
});
it('repairs an optional-only questionnaire with the normal edit and make-available flow',async()=>{
  mocks.published=true;mocks.supportOnly=true;
  mocks.rpc.mockImplementation(async(name:string)=>({data:name==='rev_vocational_create_revision'?{id:'revision',version:2,status:'draft'}:
    name==='save_rev_vocational_template'?{id:'revision',version:3,status:'draft'}:{id:'revision',status:'published'},error:null}));
  render(<VocationalProfileBuilder {...props}/>);
  await screen.findByLabelText('Questionnaire name');
  fireEvent.click(screen.getByRole('button',{name:'Edit questionnaire'}));
  await screen.findByText(/Suggested employment questions have been added/);
  fireEvent.click(screen.getByRole('button',{name:'Save and make available'}));
  expect(await screen.findByText(/Questionnaire is now available to assigned staff/)).toBeVisible();
  const saved=mocks.rpc.mock.calls.find(([name])=>name==='save_rev_vocational_template')![1];
  expect(saved.target_template_id).toBe('revision');
  expect(saved.target_sections[0].title).toBe('Criminal Justice and Resettlement Support');
  expect(saved.target_sections[0].questions).toHaveLength(1);
  expect(saved.target_sections.flatMap((section:{questions:unknown[]})=>section.questions)).toHaveLength(9);
  expect(window.confirm).not.toHaveBeenCalled();
});
