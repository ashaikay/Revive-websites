# REV Global Access Security Model

**Phase:** 2D.0.1 — Tenant Security, Migration Cleanup and Global AI Access Architecture
**Status:** Local design only; no remote implementation

## 1. Tenant User Context

A tenant user is authenticated by Supabase Auth and receives access only through an active `workspace_members` row. The effective authorization chain is:

```text
Auth user identity
  -> active workspace membership
  -> workspace role and capability
  -> workspace-scoped repository operation
  -> database RLS
```

Knowing or guessing another `workspace_id` is never sufficient. The application must derive the selected workspace from memberships, validate the role for the requested operation, and pass the workspace scope to every repository/service call. RLS remains the final database boundary.

Tenant users must not receive service-role credentials, database passwords, Secret keys, or unrestricted cross-workspace query results.

## 2. REV System-Agent Context

REV is not a tenant user and must not be represented by a magic global workspace or by broad frontend access. A trusted server-side orchestrator may process multiple authorised businesses, but each job enters one explicit workspace context at a time.

A future execution context should include:

```typescript
type REVExecutionContext = {
  jobId: string;
  workspaceId: string;
  goalId?: string;
  actionId?: string;
  actorType: 'rev' | 'system';
  capability: string;
  approvalRequired: boolean;
  correlationId: string;
};
```

The scheduler selects an authorised job, creates this context, loads only that workspace's Business Brain and operational data, performs the allowed capability, writes the action/memory/audit records in the same workspace, and exits the context before processing another workspace.

## 3. Privileged Backend Access

The future topology is:

```text
Browser
  -> authenticated Supabase user + RLS

REV backend/orchestrator
  -> trusted server-side environment
  -> privileged credential held only on the server
  -> explicit workspace guard
  -> tenant-scoped repository operation
  -> action/memory/audit trail
```

A privileged credential must never appear in React, Vite public environment variables, browser JavaScript, localStorage, model prompts, or client responses.

Conceptual guard:

```typescript
async function withWorkspaceContext<T>(
  context: REVExecutionContext,
  operation: (scope: { workspaceId: string; actor: string }) => Promise<T>,
): Promise<T> {
  await assertAuthorisedJob(context.jobId, context.workspaceId, context.capability);
  await auditAccessStart(context);
  try {
    return await operation({ workspaceId: context.workspaceId, actor: context.actorType });
  } finally {
    await auditAccessEnd(context);
  }
}
```

The guard is not a replacement for database RLS. It is an application-level control that ensures every privileged operation has an explicit workspace, capability, actor, approval state, and correlation ID.

## 4. AI Cross-Tenant Leakage Controls

- Retrieve only the current execution context's workspace data.
- Require `workspaceId` for memory, vector, search, file, and document retrieval.
- Scope tools, caches, conversation history, and background jobs by workspace.
- Never construct a prompt containing unrelated tenants for convenience or global context.
- Do not allow model-generated workspace IDs to become trusted authorization.
- The application selects and validates the workspace before the model is called.
- Do not expose privileged credentials to the model.
- Avoid global semantic search across customer data unless a separately approved administrative capability exists.
- Audit every autonomous action, data access, approval decision, and outcome with workspace and correlation identifiers.
- Clear or destroy the workspace context before processing the next job.

## 5. Progressive Autonomy

V1 remains approval-first:

- REV may research, reason, draft, and recommend.
- External actions remain `approvalRequired = true` unless a separately configured rule permits otherwise.
- Approval decisions must be made by an authorised member of the same workspace or by an explicitly authorised system workflow.
- Execution records remain linked to the workspace, goal, action, actor, and approval.

Higher autonomy levels require capability-specific policy, rate limits, audit review, and rollback procedures. They must not use broader database access as a shortcut.

## 6. International Readiness

The current V1 model does not hard-code UK-only addresses, GBP, one timezone, locale, phone format, or country. Existing fields are mostly provider-agnostic text/JSON values.

**NOW:** Keep the lean schema and require future onboarding/application settings to carry country, timezone, locale, and default currency at the workspace/business-profile boundary before international activation.

**LATER:** Add explicit `country_code`, IANA `timezone`, BCP-47 `locale`, and ISO-4217 `default_currency` fields, plus locale-aware phone/address value objects and per-workspace formatting. Add jurisdiction-specific compliance and communication rules by playbook.

Do not add international complexity to the database migration until the product requirements and validation rules are defined.

## 7. Current Local Findings

- All proposed tenant-owned tables carry `workspace_id`.
- Child action/approval records use composite foreign keys containing `workspace_id`.
- Local security-definer helpers now use an empty search path, schema-qualified references, and `authenticated`-only execution grants.
- Local migration now includes `create_workspace_with_owner(text,text)` with authenticated-only execution, `auth.uid()` creator identity, internal owner assignment, and atomic audit insertion.
- Local audit policy is read/insert only for tenant users; update/delete policies are absent.
- Local tests cover membership, inverse workspace visibility, cross-tenant service/approval denial, memory isolation, composite foreign-key declarations, and quote-workflow protection.
- The migration remains local and unapplied.

## 8. Remaining Review Gates

Before Phase 2D.1:

1. Resolve the local migration version layout; the rollback file has been moved out of `supabase/migrations/`.
2. Review and integration-test the workspace bootstrap RPC because the migration provides no normal authenticated workspace INSERT policy.
3. Confirm function owners and execute grants against the live target during a separately approved migration review.
4. Run real Supabase RLS integration tests with controlled identities in a non-production environment.
5. Keep the protected `public.quotes` and Telegram workflow unchanged.
