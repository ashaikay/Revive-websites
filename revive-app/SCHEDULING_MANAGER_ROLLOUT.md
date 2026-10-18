# Scheduling manager pilot

A workspace owner/admin can give an active Member permission to manage operational
Scheduling without changing their workspace role. Section access and management
permission are separate requirements. Viewers cannot receive this permission.
No staff member is granted it automatically.

Included: workers and their roles/skills, working patterns, unavailability/sickness
without medical details, jobs, daily sessions, assignments/cancellations. Existing
allocation, overlap, capacity, skill, inactive-worker and version guards remain.
Annual leave administration, organisation business-hours changes, staff invitations,
module permissions and document upload/analysis remain owner/admin operations.
No paid provider is enabled and no user is promoted to admin.

## Review and rollout order

1. Apply the guarded source patch. Run tests, function checks and build.
2. Commit only its listed paths. Require green `REV Scheduling manager access
   verification`, including its isolated database job, and existing workflows.
3. From a clean archive of that exact green commit, review the linked database
   dry-run. It should list only `20261018220000_rev_scheduling_management_access.sql`.
4. Apply that migration after review. Do not deploy from the dirty working tree.
5. Set the dedicated `REV_SCHEDULING_ALLOWED_ORIGINS` allowlist to
   `https://rev11.netlify.app,http://localhost:5180`. The calendar setting remains
   unchanged. The original single-origin setting remains a fallback if the new
   setting is absent. No wildcard or suffix matching is enabled.
6. Deploy only these six functions (API bundling is supported):
   `rev-worker-save`, `rev-worker-pattern-save`, `rev-worker-unavailability-save`,
   `rev-scheduling-job-save`, `rev-scheduling-assignment-save`,
   `rev-scheduling-daily-sessions-save`. Include `_shared/schedulingOrigins.ts`.
   Publish the same frontend commit through the existing Netlify deployment.
7. In the owner account, Outcomes > My team > Invite or manage staff, enable
   Scheduling under Section access for the pilot staff member. Under Scheduling
   manager select that person, tick Manage Scheduling and Save Scheduling permission.
   Keep them as Member. Do not alter Janet's programme/caseload for this pilot.
8. In the staff member's separate browser session, refresh/re-sign-in. Check worker,
   working-hours, job and assignment saves with clearly labelled pilot records.
   Verify data persists after refresh. Verify annual leave administration and
   document tools are absent and organisation/module controls are unavailable.
9. Revoke management permission. Verify reads and exact write retries fail closed.
   Module revocation, member suspension and workspace suspension also revoke it.
   Revoke through the same versioned control; do not delete records to withdraw access.

The UI checks permission on opening, focus and every 30 seconds. Every delegated
write rechecks it inside the database transaction before returning a saved replay.
Workspace locking serialises permission changes with operational writes. Unknown
permission-save outcomes retain the exact request ID/payload in sessionStorage and
lock team/programme navigation. Definitive refusals require a fresh read.
This grant never grants a programme ES registration or participant/case-note access.
No hosted migration, permission assignment, deployment or environment change is
performed by applying the patch. Isolated local CI is the release gate; an embedded
Postgres check does not replace hosted pilot verification.
