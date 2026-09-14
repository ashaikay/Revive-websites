import { describe, expect, it } from 'vitest';
import { SignInError, classifySignInError } from '@/services/authService';

describe('Phase 3B sign-in error mapping', () => {
  it('classifies invalid credentials distinctly from other failures', () => {
    const error = new SignInError('invalid_credentials', 'Invalid login credentials');
    expect(classifySignInError(error)).toBe('invalid_credentials');
  });

  it('classifies missing Supabase configuration distinctly from a credential failure', () => {
    const error = new SignInError('configuration', 'Supabase client is not configured');
    expect(classifySignInError(error)).toBe('configuration');
  });

  it('classifies a network/auth-service failure distinctly from a credential failure', () => {
    const error = new SignInError('network', 'fetch failed');
    expect(classifySignInError(error)).toBe('network');
  });

  it('never classifies an unrecognised error as invalid credentials', () => {
    expect(classifySignInError(new Error('unexpected'))).toBe('network');
    expect(classifySignInError('not an error object')).toBe('network');
  });
});
