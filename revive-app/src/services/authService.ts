import { supabaseClient } from '@/data/supabaseClient';

export type AuthMode = 'mock-development' | 'supabase-auth';

/** Distinguishes why sign-in failed so the UI never shows a credential message for a non-credential cause. */
export type SignInErrorCategory = 'invalid_credentials' | 'configuration' | 'network';

export class SignInError extends Error {
  readonly category: SignInErrorCategory;

  constructor(category: SignInErrorCategory, message: string) {
    super(message);
    this.name = 'SignInError';
    this.category = category;
  }
}

/** Classifies a thrown sign-in error so the UI never presents a non-credential failure as an invalid password. */
export function classifySignInError(error: unknown): SignInErrorCategory {
  if (error instanceof SignInError) return error.category;
  return 'network';
}

export interface AuthSession {
  userId: string;
  email: string;
  displayName: string;
  mode: AuthMode;
}

export interface AuthProvider {
  getSession(): AuthSession | null;
  signIn(email: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  initialize?(): Promise<AuthSession | null>;
  subscribe?(listener: (session: AuthSession | null) => void): () => void;
}

export class MockAuthProvider implements AuthProvider {
  private session: AuthSession | null = {
    userId: 'user-1',
    email: 'mike@revive.ai',
    displayName: 'Mike',
    mode: 'mock-development',
  };

  getSession(): AuthSession | null {
    return this.session;
  }

  async signIn(email: string): Promise<AuthSession> {
    this.session = {
      userId: 'user-1',
      email,
      displayName: 'Mike',
      mode: 'mock-development',
    };
    return this.session;
  }

  async signOut(): Promise<void> {
    this.session = null;
  }
}

export class SupabaseAuthProvider implements AuthProvider {
  private session: AuthSession | null = null;

  getSession(): AuthSession | null {
    return this.session;
  }

  async initialize(): Promise<AuthSession | null> {
    if (!supabaseClient) throw new Error('Supabase client is not configured');
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    this.session = data.session?.user ? this.toSession(data.session.user) : null;
    return this.session;
  }

  subscribe(listener: (session: AuthSession | null) => void): () => void {
    if (!supabaseClient) return () => undefined;
    const { data } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      this.session = session?.user ? this.toSession(session.user) : null;
      listener(this.session);
    });
    return () => data.subscription.unsubscribe();
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    if (!supabaseClient) throw new SignInError('configuration', 'Supabase client is not configured');
    let result: Awaited<ReturnType<typeof supabaseClient.auth.signInWithPassword>>;
    try {
      result = await supabaseClient.auth.signInWithPassword({ email, password });
    } catch (networkError) {
      throw new SignInError('network', networkError instanceof Error ? networkError.message : 'Network error');
    }
    const { data, error } = result;
    if (error) {
      const status = 'status' in error ? error.status : undefined;
      if (status === 400 || status === 422) throw new SignInError('invalid_credentials', error.message);
      throw new SignInError('network', error.message);
    }
    if (!data.user) throw new SignInError('invalid_credentials', 'Authentication failed');
    this.session = this.toSession(data.user);
    return this.session;
  }

  async signOut(): Promise<void> {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    this.session = null;
  }

  private toSession(user: { id: string; email?: string }): AuthSession {
    return {
      userId: user.id,
      email: user.email ?? '',
      displayName: user.email?.split('@')[0] ?? 'REV user',
      mode: 'supabase-auth',
    };
  }
}

const configuredMode = import.meta.env.VITE_REV_PROVIDER_MODE;
export const dataProviderMode = configuredMode === 'supabase' ? 'supabase' : 'mock-development';
export const authProvider: AuthProvider = dataProviderMode === 'supabase'
  ? new SupabaseAuthProvider()
  : new MockAuthProvider();
