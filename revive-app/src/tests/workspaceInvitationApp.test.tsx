// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  recovery: false,
  rpc: vi.fn(),
  session: null as null | { userId: string; email: string },
  context: { user: {}, workspaces: [] as Array<{ id: string }> },
  calendar: null as null | { code: string; state: string; failed: boolean },
  store: { currentWorkspaceId: '', isInitializing: true, initializationError: 'No workspace yet', setLiveContext: vi.fn(), setInitialization: vi.fn(), clearTenantState: vi.fn(), switchWorkspace: vi.fn() },
}));
vi.mock('@/services/passwordRecoveryBrowser', () => ({ passwordRecoveryEntry: { get active() { return mocks.recovery; } } }));
vi.mock('@/components/PasswordRecoveryPanel', () => ({ PasswordRecoveryPanel: () => <h1>Set your password</h1> }));
vi.mock('@/hooks/useAppStore', () => ({ useAppStore: () => mocks.store }));
vi.mock('@/services/authService', () => ({ authProvider: { getSession: () => null, initialize: async () => mocks.session, subscribe: () => undefined, signIn: vi.fn(), signOut: vi.fn() }, classifySignInError: () => 'network' }));
vi.mock('@/data/provider', () => ({ dataProviderMode: 'supabase' }));
vi.mock('@/services/supabaseContextService', () => ({ loadLiveWorkspaceContext: async () => mocks.context }));
vi.mock('@/services/calendarOAuthBrowser', () => ({ get calendarOAuthReturn() { return mocks.calendar; } }));
vi.mock('@/data/supabaseClient', () => ({ supabaseClient: { rpc: mocks.rpc, auth: { getUser: async () => ({ data: { user: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } } }));
vi.mock('@/components/Navigation', () => ({ Navigation: ({allowedPages}: {allowedPages?: string[]}) => <nav aria-label="Test navigation">{allowedPages?.map(page=><span key={page}>{page}</span>)}</nav> }));
vi.mock('@/components/HomeDashboard', () => ({ HomeDashboard: () => null }));
vi.mock('@/components/REVInterface', () => ({ REVInterface: () => null }));
vi.mock('@/components/CustomersModule', () => ({ CustomersModule: () => null }));
vi.mock('@/components/GrowthArea', () => ({ GrowthArea: () => null }));
vi.mock('@/components/BusinessModule', () => ({ BusinessModule: () => <p>Business screen</p> }));
vi.mock('@/components/SchedulingModule', () => ({ SchedulingModule: () => null }));
vi.mock('@/components/OutlookConnectionPanel', () => ({ OutlookConnectionPanel: () => null }));
vi.mock('@/components/AppFooter', () => ({ AppFooter: () => null }));
vi.mock('@/components/ProgrammeHubModule', () => ({ ProgrammeHubModule: () => <p>Authorised Outcomes screen</p> }));
import App from '@/App';
beforeEach(() => { mocks.recovery = false; mocks.calendar = null; mocks.session = null; mocks.store.switchWorkspace.mockClear(); window.history.replaceState(null, '', '/'); });
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });
it('shows an invitation before the no-workspace and initialization guards', async () => {
  window.history.replaceState(null, '', '/?rev_team_invite=44444444-4444-4444-8444-444444444444');
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Join your REV team' })).toBeVisible();
  expect(screen.queryByText('Loading your REV workspace...')).toBeNull();
});
it('keeps the normal initialization flow when there is no invitation', () => {
  render(<App />); expect(screen.getByText('Loading your REV workspace...')).toBeVisible();
});
it('does not hijack the existing calendar callback with an invitation parameter', () => {
  mocks.calendar = { code: 'test', state: 'test', failed: false };
  window.history.replaceState(null, '', '/calendar/outlook/callback?rev_team_invite=44444444-4444-4444-8444-444444444444');
  render(<App />); expect(screen.queryByRole('heading', { name: 'Join your REV team' })).toBeNull(); expect(screen.getByText('Loading your REV workspace...')).toBeVisible();
});
it('shows a clear unavailable page for malformed invitation identifiers', () => {
  window.history.replaceState(null, '', '/?rev_team_invite=bad'); render(<App />); expect(screen.getByRole('heading', { name: 'Invitation unavailable' })).toBeVisible();
});

it('selects the accepted organisation only after checking the authorised workspace list', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  mocks.session = { userId: 'user', email: 'staff@example.test' }; mocks.context.workspaces = [{ id }];
  window.history.replaceState(null, '', '/?rev_team_workspace=' + id + '#programme'); render(<App />);
  await waitFor(() => expect(mocks.store.switchWorkspace).toHaveBeenCalledWith(id));
  expect(window.location.search).toBe('');
});
it('does not grant access using a guessed workspace in the return URL', async () => {
  mocks.session = { userId: 'user', email: 'staff@example.test' }; mocks.context.workspaces = [];
  window.history.replaceState(null, '', '/?rev_team_workspace=11111111-1111-4111-8111-111111111111'); render(<App />);
  await waitFor(() => expect(window.location.search).toBe(''));
  expect(mocks.store.switchWorkspace).not.toHaveBeenCalled();
});

it('restricts the actual App route and navigation for an Outcomes-only account', async () => {
 const ws='11111111-1111-4111-8111-111111111111', user='33333333-3333-4333-8333-333333333333';
 mocks.store.currentWorkspaceId=ws;mocks.store.isInitializing=false;mocks.store.initializationError='';
 mocks.session={userId:user,email:'es@example.test'};
 mocks.rpc.mockResolvedValue({data:{workspaceId:ws,userId:user,modules:['programme'],version:1,managed:false},error:null});
 window.history.replaceState(null,'','/#business');
 try {
  render(<App/>);expect(await screen.findByText('Authorised Outcomes screen')).toBeVisible();
  expect(screen.queryByText('Business screen')).toBeNull();expect(screen.getByRole('navigation',{name:'Test navigation'})).toHaveTextContent('programme');
  expect(screen.getByRole('navigation',{name:'Test navigation'})).not.toHaveTextContent('business');
 } finally {mocks.store.currentWorkspaceId='';mocks.store.isInitializing=true;mocks.store.initializationError='No workspace yet';}
});
it('does not render any App workspace module when section access cannot be verified', async () => {
 const ws='11111111-1111-4111-8111-111111111111', user='33333333-3333-4333-8333-333333333333';
 mocks.store.currentWorkspaceId=ws;mocks.store.isInitializing=false;mocks.store.initializationError='';mocks.session={userId:user,email:'es@example.test'};
 mocks.rpc.mockResolvedValue({data:null,error:{code:'42501'}});
 try {render(<App/>);expect(await screen.findByRole('alert')).toHaveTextContent('Section access could not be loaded.');expect(screen.queryByText('Authorised Outcomes screen')).toBeNull();}
 finally {mocks.store.currentWorkspaceId='';mocks.store.isInitializing=true;mocks.store.initializationError='No workspace yet';}
});

it('shows password recovery before invitation and workspace guards', () => {
  mocks.recovery = true;
  window.history.replaceState(null, '', '/?rev_auth_recovery=1&rev_team_invite=44444444-4444-4444-8444-444444444444');
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Set your password' })).toBeVisible();
  expect(screen.queryByText('Loading your REV workspace...')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Join your REV team' })).toBeNull();
});
