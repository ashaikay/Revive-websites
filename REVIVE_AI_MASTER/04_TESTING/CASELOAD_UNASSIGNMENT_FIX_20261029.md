# Caseload unassignment: ambiguous variable

Hosted evidence: `programme_hub_save_rpc_rejected` reports operation participant_adviser, PostgreSQL 42702. Reproduced locally: the versioned assignment lookup compares `assignment.participant_id = participant_id`; the unqualified right-hand name conflicts with the function's local variable. Previously the local harness exercised revocation by privileged PATCH rather than the actual versioned assignment update, so it did not catch this path.

The additive migration performs a guarded rename of exactly five local-variable fragments in the installed save function, preserving the rest of its definition and grants. It refuses unexpected definitions instead of replacing unrelated hosted changes. No table data, permissions, version checks, audit behavior or retained-request ledger changes.

The rollback-only SQL regression failed before the migration with the same ambiguous-column lookup and passed after it. It covers unassignment, inactive assignment preservation, exactly one audit event, exact retained-request replay, changed-request refusal, stale version refusal and reactivation. No hosted correction has been run from this environment.

Rollout: download commit, apply only 20261029002000_rev_caseload_assignment_variable_fix.sql, then retry the existing retained unassignment once. That retry will unassign the adviser if the earlier failed transaction did not commit; it is not an undo. The independent employer CORS changes also await Edge deployment. PR remains unmerged.
