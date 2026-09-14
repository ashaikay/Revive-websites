# Test Log

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
