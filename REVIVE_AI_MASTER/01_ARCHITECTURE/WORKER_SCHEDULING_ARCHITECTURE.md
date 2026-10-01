# REV Worker Scheduling and Allocation

Status: MVP priority authorised by Mike on 30 September 2026.
Worker records, working patterns and unavailable periods are implemented. Hosted save, edit, cancellation and refresh persistence have been verified. Jobs/shifts and assignment authority are next.

## Multi-day daytime sessions — local implementation complete

The existing `20261001000000_rev_daily_job_sessions.sql` migration is applied locally only. New jobs default to an explicit daily-working-hours batch: inclusive first/last dates, selected weekdays, local start/end, IANA timezone and staffing required per generated session. Each selected date creates a separate open job; no overnight interval is inferred. The range is limited to 31 calendar days.

An authenticated owner/admin Edge Function validates the exact request, resolves the caller from the session and invokes the existing service-role-only `create_rev_daily_job_sessions` RPC. Responses contain sanitized job metadata only. Unknown outcomes are not retried automatically: the canonical request remains in workspace/user-scoped session storage and only an explicit identical retry is offered. A confirmed save emits the existing `rev-scheduling-changed` event so the single central planner refreshes.

Existing job editing, cancellation and assignment remain on their existing paths. Saved intervals spanning local dates display an overnight warning and are never silently split or converted.

Validation completed on 1 October 2026:

- Scheduling endpoint/browser regressions: 61/61 passed.
- Local daily-session validator: `SCHEDULING_DAILY_SESSIONS_LOCAL=PASS`.
- Local assignment validator: `SCHEDULING_ASSIGNMENTS_LOCAL=PASS`.
- Production build: passed with the existing chunk-size advisory.
- Local migration check used `migration up --local`; no database reset and no new migration application occurred.
- No provider requests, notifications, automatic allocation, location/travel calculations or hosted deployment occurred.

Remaining limitations: overnight work is unsupported; DST gaps/folds reject the whole batch; each generated session is edited or cancelled individually after creation; worker allocation remains manual; notifications and travel/location feasibility remain deferred.

## Product workflow

Scheduling is a main-navigation module.
Setup: add workers, record their availability and skills, then create jobs/shifts.
Planning: view the weekly rota, identify unfilled work and assign suitable workers.
Changes: amend or cancel assignments with explicit conflict checks and audit evidence.

## Domain boundaries

Worker scheduling is separate from customer meeting proposals and calendar events.
A worker record does not grant application access or create a workspace membership.
An optional linked user must belong to the same workspace.
Google and Outlook integrations are not required for internal scheduling.
Assignment does not send a notification, create an external event or prove attendance.

## First-release records

- Worker: workspace, display name, active status, role labels, skill tags and optional linked workspace user.
- Working pattern: worker, timezone, weekdays, local opening/closing times and effective dates.
- Availability exception: worker, explicit UTC interval and unavailable category such as leave.
- Job/shift: workspace, title, UTC start/end, display timezone, location, required skills, staffing count and status.
- Assignment: workspace, worker, job/shift, reserved UTC interval and active/cancelled status.

Leave records contain only information needed for scheduling; medical details are excluded.
Skill tags are manager-recorded information, not proof of qualifications.
Workers and scheduling history are archived rather than deleted through normal UI flows.

## Permissions and isolation

Initial management and rota access are restricted to active owners/admins.
Member/viewer access and worker self-service are deferred until explicitly designed.
Reuse public.has_workspace_role for manager reads.
Browser clients cannot write scheduling tables directly.
Authenticated server boundaries verify the caller and workspace role.
Trusted RPCs recheck active authority within the mutation transaction.
Every relationship between scheduling records includes workspace identity.

## Assignment authority

Assignment requires an active worker and an open job/shift in the same workspace.
The complete interval must fit recorded working availability.
Missing availability blocks allocation.
Leave/unavailable exceptions block overlapping assignments.
Required skills must be present and staffing capacity must remain available.
Active assignments for the same worker cannot overlap, including across different jobs.
Intervals use [start,end): adjacent assignments are permitted.
Concurrent requests must enforce overlap and capacity protection in the database.
Repeated request IDs are idempotent; changed content under the same ID is rejected.
Stale record versions are rejected rather than silently overwritten.
Job edits, availability changes and worker deactivation must check affected assignments.
Conflicting changes require explicit reassignment or cancellation first.

## Time handling

Store assignment and job intervals as UTC instants; retain an IANA display timezone.
Evaluate working patterns in their recorded local timezone.
Reject nonexistent or ambiguous local times unless explicitly resolved.
No automatic inference of worker availability from customer calendar free/busy.
Workspace business hours may assist setup but are not implicit worker availability.

## Audit

Scheduling mutations write to the existing append-only public.audit_log.
Record verified actor, workspace, operation, resource identifiers and relevant versions.
Avoid sensitive leave descriptions and unnecessary personal data in audit metadata.
Audit writes and scheduling changes must commit atomically.

## Delivery order

1. Tenant-scoped worker records and owner/admin management.
2. Working patterns and unavailable periods.
3. Jobs/shifts and staffing requirements.
4. Atomic assignment, cancellation, capacity and overlap enforcement.
5. Weekly rota, unfilled work and conflict explanations.
6. Local security/concurrency checks, CI and controlled hosted verification.

## Verification requirements

Test owner/admin permissions, member/viewer denial, suspension and tenant isolation.
Test same-worker overlaps, adjacent intervals, leave, missing skills and full capacity.
Test concurrent allocation, repeated requests and stale updates.
Test daylight-saving transitions and persistence after refresh.
Existing customer-calendar and meeting workflows must remain intact.

## Deferred scope

Automatic allocation, worker self-service, outbound notifications, payroll, timesheets,
travel-time calculation, dispatch, route optimisation and external calendar sync.
These are not dependencies for the first supervised scheduling release.
## Optional location planning and visual planner

Authorised product requirements recorded on 30 September 2026.

Provide a simple weekly planner with workers as rows and days as columns.
Cards show job title, time, location and assignment status.
Use colours plus text labels for proposed work, assigned work, leave and conflicts.
Reflect saved changes throughout the week; show loading, stale and failed-refresh states.
Initial access remains restricted to active owners/admins.

Location-based recommendations are optional per business.
Record worker location plans separately from working availability.
Use scoped, verified job/customer locations and relevant Business Brain information.
Recommendations must respect skills, hours, leave, existing assignments and capacity.
Proximity alone does not establish feasibility; travel assumptions must be explicit.
Missing location or travel information must not be presented as confirmed feasibility.

Delivery progresses from manual allocation to recommendations and approved schedules.
Automatic allocation requires explicit business opt-in and defined operating rules.
Schedule changes must be visible and auditable; conflicts require manager attention.
Notifications require separately enabled sending, verified recipients and approval rules.
Worker self-service must not expose Business Brain, CRM or other restricted information.

These requirements follow reliable manual assignment enforcement.
Automatic allocation and notifications are not enabled by the current implementation.