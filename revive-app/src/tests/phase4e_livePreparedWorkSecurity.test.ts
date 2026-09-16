import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLATFORM_EXECUTION_ENABLED } from '@/services/executionPolicyService';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('Phase 4E live prepared-work security contracts', () => {
  it('reuses Phase 4C role-specific action, approval, and memory policies', () => {
    const migration = source('../../supabase/migrations/20260914183000_rev_execution_control_plane.sql');
    expect(migration).toContain("public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])");
    expect(migration).toContain('create policy approvals_insert_pending');
    expect(migration).toContain("public.has_workspace_role(locked_approval.workspace_id, array['owner', 'admin'])");
    expect(migration).toContain('create policy memory_events_insert_user');
    expect(migration).toContain("created_by_type = 'user' and created_by_id = auth.uid()");
    expect(migration).toContain("raise exception 'stale approval review'");
  });

  it('uses only the browser-safe Supabase client and the trusted approval RPC', () => {
    const repository = source('../data/supabasePreparedWorkRepository.ts');
    expect(repository).toContain("from './supabaseClient'");
    expect(repository).toContain("rpc('decide_rev_action_approval'");
    expect(repository).not.toMatch(/service[_-]?role/i);
    expect(repository).not.toMatch(/SUPABASE_SECRET|sb_secret_/i);
  });

  it('keeps execution false and exposes no Send control in live REV', () => {
    const interfaceSource = source('../components/REVInterface.tsx');
    expect(PLATFORM_EXECUTION_ENABLED).toBe(false);
    expect(interfaceSource).toContain('APPROVED — NOT SENT');
    expect(interfaceSource).not.toMatch(/<button[^>]*>\s*Send\s*<\/button>/i);
    expect(interfaceSource).not.toMatch(/<button[^>]*>\s*Execute\s*<\/button>/i);
  });

  it('does not reference protected quote or Telegram systems', () => {
    const repository = source('../data/supabasePreparedWorkRepository.ts');
    expect(repository).not.toContain('public.quotes');
    expect(repository).not.toContain("from('quotes')");
    expect(repository).not.toMatch(/telegram/i);
  });
});
