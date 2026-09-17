import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260917000000_rev_email_semantic_idempotency.sql', import.meta.url),
  'utf8',
);
const rollback = readFileSync(
  new URL('../../../REVIVE_AI_MASTER/rollback/20260917000000_rev_email_semantic_idempotency_rollback.sql', import.meta.url),
  'utf8',
);

describe('Phase 4G.2A-S semantic email idempotency migration', () => {
  it('stops on duplicate or ambiguous existing email evidence', () => {
    expect(migration).toContain("having count(*) > 1");
    expect(migration).toContain('semantic duplicates exist; review evidence before migration');
    expect(migration).toContain('provider evidence exists; review evidence before migration');
    expect(migration).not.toMatch(/delete\s+from\s+public\.rev_action_executions/i);
  });

  it('enforces one semantic execution per approved email action version', () => {
    expect(migration).toContain('rev_action_executions_send_email_semantic_unique');
    expect(migration).toContain('workspace_id, action_id, action_version, capability');
    expect(migration).toContain("where capability = 'SEND_APPROVED_EMAIL'");
    expect(migration).toContain("effective_idempotency_key := 'send-approved-email:'");
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(migration).toContain("raise exception 'semantic execution conflict'");
  });

  it('adds only the approved provider outcome vocabulary and transition shapes', () => {
    for (const outcome of [
      'provider_not_invoked', 'provider_attempt_claimed', 'accepted_by_provider',
      'rejected_by_provider', 'provider_outcome_unknown',
    ]) expect(migration).toContain(outcome);
    expect(migration).toContain("provider_outcome = 'provider_attempt_claimed' and status = 'in_progress'");
    expect(migration).toContain("provider_outcome = 'accepted_by_provider' and status = 'succeeded'");
    expect(migration).toContain('Accepted by provider; delivery remains unknown.');
    expect(migration).not.toMatch(/delivered/i);
  });

  it('keeps claim and email result transitions backend-only', () => {
    expect(migration).toContain('claim_rev_action_provider_attempt');
    expect(migration).toContain('record_email_execution_result');
    expect(migration).toContain("current_user <> 'service_role'");
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
    expect(migration).toContain('email provider outcome must use record_email_execution_result');
  });

  it('revalidates approval, workspace policy, capability, and cost at claim time', () => {
    expect(migration).toContain("locked_action.action_type <> 'prepare_follow_up'");
    expect(migration).toContain("locked_action.status <> 'approved'");
    expect(migration).toContain('locked_action.action_version <> locked_execution.action_version');
    expect(migration).toContain('current_fingerprint <> locked_execution.approval_fingerprint');
    expect(migration).toContain("decision = 'approved'");
    expect(migration).toContain('not policy.execution_enabled');
    expect(migration).toContain('per-attempt provider cost ceiling exceeded');
    expect(migration).toContain('monthly provider cost ceiling exceeded');
  });

  it('does not alter RLS, enable execution, or touch protected systems', () => {
    expect(migration).not.toMatch(/create\s+policy|drop\s+policy|disable\s+row\s+level\s+security/i);
    expect(migration).not.toMatch(/execution_enabled\s*=\s*true/i);
    expect(migration).not.toMatch(/\bquotes\b|telegram|fatherlegacy|motherlegacy/i);
  });
});

describe('Phase 4G.2A-S guarded rollback', () => {
  it('refuses evidence deletion and restores Phase 4C functions and ACLs', () => {
    expect(rollback).toContain("capability = 'SEND_APPROVED_EMAIL' or provider_outcome is not null");
    expect(rollback).toContain('disable execution and forward-fix');
    expect(rollback).toContain('create or replace function public.prepare_rev_action_execution');
    expect(rollback).toContain('create or replace function public.record_rev_action_execution_result');
    expect(rollback).toContain('to authenticated');
    expect(rollback).toContain('to service_role');
    expect(rollback).not.toMatch(/delete\s+from/i);
  });
});