# Workspace staff invitations — prepared source

Status: migration not applied, no hosted accounts/memberships changed and no emails sent by this task.

## Staff workflow

My team → Invite or manage staff → create a private invitation link. Creating the link does not email anyone or activate access. The recipient signs in or creates and confirms their account, then explicitly accepts using the matching email. The manager uses Refresh team, then Add ES to programme and the existing caseload assignment controls.

New membership is the existing standard `member` role, including existing workspace-wide member permissions. Programme/caseload access remains separate. Existing roles are not upgraded; an invitation cannot reactivate a suspended member. This does not create a new programme-only role.

## Server controls

SECURITY DEFINER RPCs derive the actor from auth.uid(), use an empty search_path and explicit references, enforce active owner/admin authority, and write an audit record atomically. No direct tenant membership/profile/invitation writes are granted. Private request results cannot be read by tenants.

Invitations use unpredictable private identifiers, matching confirmed Auth email, seven-day expiry, revocation, a 50/day organisation limit, durable exact replay and changed-retry refusal. Treat invitation links as private; do not publish/log them. They contain no Auth access/refresh tokens.

Active members can read minimal organisation-scoped staff names only. Invitation email addresses are manager-only. Names are not taken from user-editable Auth metadata. Name edits carry a version; suspension/restoration carries expected status. Owners/admins cannot be suspended through these operations; member/viewer access changes require explicit confirmation and preserve case history. Restoration re-enables existing programme/caseload permissions according to RLS.

Pending writes are retained in sessionStorage scoped by actor/workspace for exact retry. Passwords and Auth credentials are never stored there. A failed team read is not an empty team.

## Validation and rollout

1. Apply the guarded source patch. Run the selected tests and the full app build in the original worktree. Preserve unrelated dirty work.
2. Commit/push only reviewed files. Require isolated CI, including `workspace_team_local_validation.mjs`, to pass. The validator rejects all remote URLs and uses only localhost:54321 fixtures. Embedded PostgreSQL checks during preparation do not prove concurrent Supabase behaviour; CI remains required.
3. Export committed `revive-app/supabase` into a temporary deployment folder, link the intended project and dry-run the pinned CLI. Only `20261016030000_rev_workspace_staff_invitations.sql` should be pending. Stop if paused/unrelated migrations appear.
4. Review and apply that migration after green CI. No Edge Function deployment, config.toml addition, provider or secret change is required.
5. Before onboarding real staff, verify that Supabase email confirmation is enabled and mail delivery works. Add the deployed REV return URL to the Auth redirect allow-list without replacing the existing Site URL, other applications' redirects or templates. Never disable email confirmation to pass an acceptance test.
6. Localhost links are only for local testing. Staff using another computer need a publicly deployed REV address. This task does not publish the site or alter hosted Auth settings.
7. Test with a controlled account: confirmation returns to REV, acceptance selects the correct authorised organisation, Refresh team reveals the name, and ES registration/caseload assignment is still required.
8. Confirm suspension denies subsequent server reads/writes and invitation replay cannot restore access. Already loaded browser data is not claimed to be remotely erased.

## RPCs and scope

- list_rev_workspace_team(uuid): manager directory and up to 100 recent invitations.
- list_rev_workspace_staff_names(uuid): minimal active staff names.
- manage_rev_workspace_team(uuid,text,uuid,jsonb): invite/revoke/rename/suspend/restore.
- accept_rev_workspace_invitation(uuid): matching confirmed account; server-selected role.

The main Programme Hub works without names during rollout. The staff panel reports setup unavailable until migration deployment. Permanent deletion, case closure, documents, sensitive fields, programme rules and AI reports remain separate work.

## Module access rollout
Apply both staff and module migrations together before any live invitation is accepted. New organisation memberships created by invitation receive Outcomes only, atomically. Existing memberships keep their current access until a manager saves an explicit section selection. Owners/admins retain all sections; module selection never promotes a Member/Viewer role.

Staff still need active programme registration and caseload assignment. Module grants do not grant another programme or another Service-user record. Suspension overrides every module grant. Home dashboard appears only with all six modules, since it aggregates cross-module information.

The module gate fails closed if the access RPC is unavailable. Deploy the reviewed backend before using this client build for live staff. Test sign-in, confirmed invitation acceptance, Outcomes-only direct URLs/API denial, manager permissions, revoked access, and existing Scheduling/meeting workflows in isolated CI before production. Background checks refresh access on focus and every 30 seconds; database enforcement applies on every new statement. No automatic sending or provider enablement.

This migration covers the explicit REV tables/RPCs from committed 1d4527b and the pending staff migration. It deliberately does not alter unrelated historical shared-project applications. Every future module/table/RPC must add its module guard; the isolated validator checks the current scope.

## Password setup and recovery

Staff invitation links are still shared manually; creating an invitation does not send email.
Account confirmation and password recovery use the configured Supabase Auth SMTP service.
Existing confirmed accounts should use “Forgot or need a password?” with their own email,
not create a second account. REV requests a recovery email with a same-origin return URL
and preserves the invitation ID. The recipient opens the newest email link, chooses and
confirms a password, then signs in and explicitly accepts the original invitation.
No membership or programme registration is created by password recovery.

Recovery callbacks are consumed once, verified against Auth, and stripped from the URL.
A stale, malformed or refreshed recovery page requires a new email link; an existing
signed-in account alone cannot unlock this form. Passwords are never stored by REV.
Test with a separate staff account in a private window, not the manager session.
Ensure the hosted REV URL is in the existing Auth redirect allowlist before testing.
Do not change shared Site URL, SMTP, confirmation requirements or other applications.
No migration, Edge Function deployment or invitation-email sender is included here.
