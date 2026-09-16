# Test Log

## 2026-09-16 - Phase 4E Live Prepared-Work Repository Integration
- Focused application contracts: 14/14 PASS, covering deterministic PostgreSQL-compatible fingerprints, persistence/reload, owner/admin review, member/viewer restrictions, cross-tenant denial, stale approval, idempotency, browser-safe credentials, disabled execution, and protected-system scope.
- Real isolated local Supabase/PostgREST/RLS proof: 1/1 PASS through authenticated disposable role identities, the browser-safe client, real repository writes/reads, RLS policies, action-version trigger behavior, and `decide_rev_action_approval`.
- Local outcomes: owner/admin prepare/edit/approve/reject PASS; member prepare PASS and direct/repository authorization denial PASS; viewer write denial PASS; outsider tenant isolation PASS; fresh repository/session reload PASS; duplicate preparation returned the existing deterministic artifact; concurrent material edit left approval pending.
- Direct database evidence: six prepared action fixtures, all `not_executed`; two approved, two rejected, two pending; zero `rev_action_executions`; zero `provider_usage_events`; zero enabled workspace execution policies.
- Environment note: Docker containers initially had a local clock skew that made PostgREST reject fresh Auth tokens as future-issued. The temporary proof harness used the same Auth-derived user UUID/claims with a locally signed, backdated local-only token; the harness and credentials were removed after validation. No policy, grant, function, migration, or application workaround was added.
- Cleanup note: deleting the disposable workspace was correctly rejected by the Phase 4C append-only approval trigger and the cleanup transaction rolled back. The isolated local validation fixtures remain as evidence; no protection was disabled or bypassed.
- Previously completed final gates remain valid: full suite 177/177 PASS; build PASS; `npm audit` 0 vulnerabilities; desktop 1440x1000 and mobile 390x844 PASS with no overflow and no Send/Execute control.
- Boundary: local Supabase only. No production Supabase, migration, RLS, quote/Telegram, marketing-site, `rev-business-verify`, provider, sending, or execution change.

## 2026-09-14 - Phase 4D Prepare Follow-Up
- Focused service/UI contracts: 15/15 PASS, covering dormant/stale drafting, evidence and missing-information disclosure, deduplication, workspace isolation, suppression/safety/unsupported-signal refusal, owner/admin authority, member/viewer denial, edit-bound approval fingerprint, rejection, protected quote non-use, and zero provider/network activity.
- Full regression: 20 files, 163/163 tests PASS; production build PASS; `npm audit --audit-level=low` found 0 vulnerabilities.
- Browser: mock-mode desktop 1440x1000 and mobile 390x844 PASS; no horizontal overflow, no internal deduplication marker, no Send or Execute button, and edit/save/approve ended at `APPROVED — NOT SENT`.
- Boundary: no migration, Supabase deployment/write, provider call, external communication, production execution, quote/Telegram, marketing-site, or `rev-business-verify` change.

## 2026-09-14 - Phase 4C migration and local security rehearsal
- Target: isolated local Supabase project `revive-app` only; pinned CLI `2.117.0`; no linked/remote command.
- Migration and catalog: PASS; 3 new RLS tables, 11 operation-specific policies, no broad authority policy, no anonymous authority grants, no authenticated evidence-write grants.
- Auth/RLS/ACL attack matrix: 42/42 PASS, covering owner/admin approval, member/viewer/suspended/outsider boundaries, tenant isolation, stale/legacy approval denial, direct evidence forgery denial, disabled defaults, dry-run preparation, idempotency, and cost ceilings.
- Rollback: populated-evidence guard PASS; empty-state rollback PASS; quote catalog unchanged.
- Regression: adjacent local tenant/opportunity attack matrix PASS; focused tests 7/7; full tests 148/148; build PASS; `npm audit` 0 vulnerabilities.
- Result: migration drafted + local rehearsal PASS. Production not applied; execution/providers remain disabled.

## 2026-09-14 - Phase 4C controlled production migration
- Target identity/history/artifact hashes: PASS; only migration `20260914183000` was pending and applied to `Revive Websites` / `ntbowgutwyyhhnmkadlv`.
- Credential-safe pre/post schema/function/count evidence: PASS; raw dumps deleted and no credential pattern retained.
- Production RLS/ACL matrix: 25/25 PASS inside one rolled-back transaction; no fixture persisted.
- Protected regression: public quote/Telegram fingerprints identical; Telegram Edge Function version/hash/status unchanged.
- Data regression: existing workflow counts unchanged; control-plane policy/execution/usage tables remain empty.
- Final validation: 148/148 tests PASS; build PASS; `npm audit` 0 vulnerabilities.

## 2026-08-25 — Repository baseline check
- Test performed: git status and branch check
- Expected result: confirm clean or safe repo state and current branch
- Actual result: repo reports `main` tracking `origin/main`; the REVIVE_AI_MASTER directory and revive-qr.png are untracked, but no app code changes were made
- Status: Pass

## 2026-08-25 — Master control initialization
- Test performed: file creation and read-back of project-control documents
- Expected result: all required files are created and readable
- Actual result: files created successfully
- Status: Pass

## Future tests
- Phase 1 architecture review
- app shell build verification
- security sanity checks
- deployment configuration review
- tenant-isolation checks
