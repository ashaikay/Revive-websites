# Simpler business questionnaire workflow — 28 October 2026

User rejected a routine workflow that required understanding editable revisions,
draft saving, publication and manually choosing versions in participant records.

## Normal workflow

- Manager: Edit questionnaire, review/change the questions, Save and make available.
- REV creates the editable copy in the background and preserves the published
  snapshot. Editing a legacy zero-core form adds core starters for manager review.
  Valid custom questionnaires are not silently expanded when edited.
- Save and make available first validates and saves changes using the existing
  request ID/ledger, then publishes only with the exact ID/version acknowledged
  by the successful save. A saved unchanged draft can be made available without
  another save. Normal editing/make-available actions do not need browser confirm
  dialogs because old published data stays intact; the primary action states its
  availability effect. Separate new-questionnaire creation still confirms intent.
- The old save-only, publication, reload and separate-questionnaire actions remain
  under More options, rather than appearing as required steps. Business labels
  replace builder/version wording in the main header and status display.
- Staff: open a Service-user profile; the newest published snapshot opens by
  default. Earlier questionnaires/saved answers are in a closed history disclosure
  when multiple snapshots exist. Closing and reopening starts with the current
  questionnaire, not a retained historical selection. Unsaved-answer discard
  still requires confirmation; writes keep closing disabled while pending.
- Earlier answers remain on their original snapshot. They are not copied,
  migrated, relabelled or marked complete on the newest questionnaire. History
  remains explicitly selectable to read those earlier answers.

## Failure handling and authority

The two existing server operations are not a single database transaction.
A synchronous workflow lock and disabled editor span both stages. Publication is
never attempted after a failed, malformed or stale-scope save. The exact retained
save request remains recoverable. A successful retry of an uncertain save does
not implicitly publish; the manager can then choose the availability action.

If the publication response is uncertain, editing/new actions are blocked and
Check availability reads the exact saved template ID within the workspace and
programme. It does not resubmit publication. A confirmed published read restores
the available state; a confirmed draft read lets the manager review/retry. Failed
verification leaves recovery pending. All callbacks/finalizers check generation
so an old programme operation cannot publish for or unlock another scope.

No schema, RLS, role, server function or auth/config changes. No actual publishing,
participant edit, email, notification, database migration or production release
was performed by this cloud review. PR #4 remains unmerged pending exact-head CI
and the simplified preview check.

## Validation

- Complete test:all: 106 Vitest files / 876 tests and 548 Node tests passed,
  1,424 total, zero failures.
- New tests cover both stages in the normal one-click action, exact acknowledged
  version use, duplicate clicks and field locks, uncertain save stopping before
  publication, exact save replay, explicit continuation after recovery, targeted
  publication verification without retry, old-scope suppression, and the
  optional-only edit/review/make-available flow without extra confirmation.
- Staff history regression verifies latest default, reading earlier saved answers,
  reopening the current form, and distinct unchanged old/new saved answers.
- Existing recovery and scope tests use More options deliberately, keeping their
  original server-authority and stale-response assertions.
- Supabase-mode production build passed; the existing bundle advisory remains.
- Default frontend build also passed after the Supabase build. git diff --check
  passed. No dependencies were added and no migration/function deployment is
  required for these frontend changes.
