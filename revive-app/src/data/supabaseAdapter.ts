import { DataProvider } from '@/domain/repositories';

/**
 * Supabase adapter boundary. This phase intentionally has no Supabase client
 * and no network implementation. The adapter is kept explicit so a later
 * controlled connection cannot leak provider calls into UI components.
 */
export interface SupabaseAdapterFactory {
  create(): DataProvider;
}

export const supabaseAdapter: SupabaseAdapterFactory = {
  create(): DataProvider {
    throw new Error('Supabase is frozen and not connected in Phase 2B.');
  },
};
