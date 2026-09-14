import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260914183000_rev_execution_control_plane.sql', import.meta.url),
  'utf8',
);
const rollback = readFileSync(
  new URL('../../../REVIVE_AI_MASTER/rollback/20260914183000_rev_execution_control_plane_rollback.sql', import.meta.url),
  'utf8',
);

describe('Phase 4C execution control-plane migration', () => {
  it('defaults every workspace to disabled, supervised, zero-cost execution', () => {
    expect(migration).toContain('execution_enabled boolean not null default false');
    expect(migration).toContain("autonomy_mode text not null default 'always_ask'");
    expect(migration).toContain('per_attempt_provider_cost_ceiling numeric(12, 4) not null default 0');
    expect(migration).toContain('monthly_provider_cost_ceiling numeric(12, 4) not null default 0');
    expect(migration).not.toMatch(/insert\s+into\s+public\.workspace_execution_policies/i);
  });

  it('binds approvals and durable attempts to action versions and fingerprints', () => {
    expect(migration).toContain('add column if not exists action_version bigint not null default 1');
    expect(migration).toContain('add column if not exists action_fingerprint text');
    expect(migration).toContain('unique (workspace_id, idempotency_key)');
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(migration).toContain('fresh bound approval required');
    expect(migration).toContain("mode text not null default 'dry_run'");
  });

  it('keeps approval authority owner/admin-only and evidence writes backend-only', () => {
    expect(migration).toContain("public.has_workspace_role(locked_approval.workspace_id, array['owner', 'admin'])");
    expect(migration).toContain("public.has_workspace_role(target_workspace_id, array['owner', 'admin'])");
    expect(migration).toContain('revoke all on table public.rev_action_executions from anon, authenticated');
    expect(migration).toContain('revoke all on table public.provider_usage_events from anon, authenticated');
    expect(migration).toContain('revoke all on table public.audit_log from anon, authenticated');
    expect(migration).toContain('to service_role');
    expect(migration).not.toContain('rev.trusted_transition');
  });

  it('uses hardened routines and does not expose live execution', () => {
    expect(migration.match(/security definer/g)).toHaveLength(2);
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("target_status not in ('succeeded', 'failed', 'cancelled')");
    expect(migration).not.toMatch(/provider.*(fetch|http|invoke)/i);
    expect(migration).not.toContain('platform_execution_enabled');
  });

  it('does not alter the protected quote or Telegram workflow', () => {
    expect(migration).not.toMatch(/\bquotes\b/i);
    expect(migration).not.toContain('quotes-telegram-alert');
    expect(migration).not.toContain('telegram-alert-ts');
  });
});

describe('Phase 4C rollback contract', () => {
  it('refuses destructive rollback after durable evidence exists', () => {
    expect(rollback).toContain("raise exception 'Phase 4C data exists");
    expect(rollback).toContain('select 1 from public.rev_action_executions');
    expect(rollback).toContain('select 1 from public.provider_usage_events');
    expect(rollback).toContain('action_fingerprint is not null');
    expect(rollback).toContain('forward-fix instead of dropping evidence');
  });

  it('does not restore broad tenant writes or touch protected systems', () => {
    const statements = rollback.replace(/--.*$/gm, '');
    expect(statements).not.toMatch(/for\s+all/i);
    expect(statements).not.toContain('audit_log_insert');
    expect(statements).not.toMatch(/\bquotes\b/i);
    expect(statements).not.toContain('telegram-alert');
  });
});
