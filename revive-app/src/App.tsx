import React, { useState } from 'react';
import { useAppStore } from '@/hooks/useAppStore';
import { Navigation } from '@/components/Navigation';
import { HomeDashboard } from '@/components/HomeDashboard';
import { REVInterface } from '@/components/REVInterface';
import { CustomersModule } from '@/components/CustomersModule';
import { GrowthArea } from '@/components/GrowthArea';
import { BusinessModule } from '@/components/BusinessModule';
import { authProvider, classifySignInError } from '@/services/authService';
import { dataProviderMode } from '@/data/provider';
import { loadLiveWorkspaceContext } from '@/services/supabaseContextService';
import '@/styles/index.css';

type Page = 'home' | 'rev' | 'customers' | 'growth' | 'business';
type LoginError = 'invalid_credentials' | 'configuration' | 'network' | 'workspace';

function App() {
  const { currentWorkspaceId, isInitializing, initializationError, setLiveContext, setInitialization, clearTenantState } = useAppStore();
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [liveSession, setLiveSession] = useState(authProvider.getSession());
  const [loginError, setLoginError] = useState<LoginError | null>(null);
  const authMode = authProvider.getSession()?.mode ?? 'signed-out';

  React.useEffect(() => {
    if (dataProviderMode !== 'supabase' || !authProvider.initialize) return;
    let mounted = true;
    setInitialization(true);
    void authProvider.initialize()
      .then(async (session) => {
        if (!mounted) return;
        if (!session) {
          setLiveSession(null);
          clearTenantState();
          setInitialization(false);
          return;
        }
        setLiveSession(session);
        const context = await loadLiveWorkspaceContext(session.userId, session.email);
        if (mounted) setLiveContext(context);
      })
      .catch((error: unknown) => {
        if (mounted) setInitialization(false, error instanceof Error ? error.message : 'Unable to load live workspace context');
      });
    const unsubscribe = authProvider.subscribe?.((session) => {
      setLiveSession(session);
      if (!session) clearTenantState();
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [clearTenantState, setInitialization, setLiveContext]);

  const handleSignIn = async (email: string, password: string) => {
    if (!authProvider.signIn) return;
    setInitialization(true);
    setLoginError(null);
    try {
      const session = await authProvider.signIn(email, password);
      setLiveSession(session);
      try {
        const context = await loadLiveWorkspaceContext(session.userId, session.email);
        setLiveContext(context);
      } catch {
        await authProvider.signOut();
        setLiveSession(null);
        clearTenantState();
        setInitialization(false);
        setLoginError('workspace');
      }
    } catch (error) {
      setInitialization(false);
      setLoginError(classifySignInError(error));
    }
  };

  const handleSignOut = async () => {
    await authProvider.signOut();
    setLiveSession(null);
    clearTenantState();
  };

  // Handle hash-based navigation
  React.useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) || 'home';
      if (['home', 'rev', 'customers', 'growth', 'business'].includes(hash)) {
        setCurrentPage(hash as Page);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (dataProviderMode === 'supabase' && isInitializing) {
    return <div className="min-h-screen grid place-items-center text-neutral-600">Loading your REV workspace...</div>;
  }

  if (dataProviderMode === 'supabase' && !liveSession) {
    return <LoginPanel error={loginError} onSignIn={handleSignIn} />;
  }

  if (dataProviderMode === 'supabase' && initializationError) {
    return <div className="min-h-screen grid place-items-center px-6 text-center text-red-700">Unable to load your authorized REV workspace.</div>;
  }

  if (dataProviderMode === 'supabase' && !currentWorkspaceId) {
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center text-neutral-600">
        <div>
          <p>No active workspace is available for this account.</p>
          <button className="btn-secondary mt-4" onClick={() => void handleSignOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <Navigation onSignOut={dataProviderMode === 'supabase' ? handleSignOut : undefined} />

      {/* Main Content */}
      <main>
        {currentPage === 'home' && <HomeDashboard workspaceId={currentWorkspaceId} />}
        {currentPage === 'rev' && <REVInterface workspaceId={currentWorkspaceId} />}
        {currentPage === 'customers' && (dataProviderMode === 'supabase' ? <LiveModeNotice /> : <CustomersModule workspaceId={currentWorkspaceId} />)}
        {currentPage === 'growth' && <GrowthArea workspaceId={currentWorkspaceId} />}
        {currentPage === 'business' && <BusinessModule workspaceId={currentWorkspaceId} />}
      </main>

      {/* Footer */}
      <footer className="bg-neutral-900 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <p className="text-center text-amber-300 text-xs font-semibold uppercase tracking-wide mb-2">
            Auth: {authMode} · Data Provider: {dataProviderMode}
          </p>
          <p className="text-center text-neutral-400 text-sm">
            REV Phase 2B Foundation · Mocked AI & Data · No external actions executed
          </p>
        </div>
      </footer>
    </div>
  );
}

function LiveModeNotice() {
  return <div className="max-w-3xl mx-auto px-6 py-16 text-center text-neutral-600">Live mode is connected for workspace context and read-only Business Brain data. This surface remains mock-backed until its Phase 2D.2 write boundary is approved.</div>;
}

function LoginPanel({ onSignIn, error }: { onSignIn: (email: string, password: string) => Promise<void>; error: LoginError | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <main className="min-h-screen bg-neutral-50 grid place-items-center px-6">
      <form className="w-full max-w-md card p-8" onSubmit={(event) => { event.preventDefault(); void onSignIn(email, password); }}>
        <p className="text-xs font-semibold tracking-[0.2em] text-primary-600 mb-3">REV LIVE MODE</p>
        <h1 className="text-3xl font-bold text-neutral-900 mb-2">Sign in to REV</h1>
        <p className="text-neutral-600 mb-6">Use your REV workspace account to continue.</p>
        {error === 'invalid_credentials' && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">The email or password could not be verified.</p>}
        {error === 'configuration' && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">REV cannot connect to the authentication service because the app configuration is incomplete.</p>}
        {error === 'network' && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">REV could not reach the authentication service. Please try again.</p>}
        {error === 'workspace' && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">You signed in successfully, but REV could not load your workspace.</p>}
        <label className="block text-sm font-medium text-neutral-700 mb-2" htmlFor="rev-email">Email</label>
        <input id="rev-email" className="w-full rounded-md border border-neutral-300 px-3 py-2 mb-4" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
        <label className="block text-sm font-medium text-neutral-700 mb-2" htmlFor="rev-password">Password</label>
        <input id="rev-password" className="w-full rounded-md border border-neutral-300 px-3 py-2 mb-6" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        <button className="btn-primary w-full" type="submit">Sign in</button>
      </form>
    </main>
  );
}

export default App;
