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

## Annual leave policy foundation

Authorised on 2 October 2026. Stage 1 is limited to manager-recorded policy, frozen worker/leave-year accounts and audited allowance adjustments. It does not calculate absence deductions or a complete remaining balance.

Workspace defaults and full per-worker overrides are versioned, append-only policy revisions. Each revision records its first applicable leave-year label, allowance input unit/value, canonical integer minutes, explicit minutes per day, leave-year start month/day and whether bank holidays are included in or additional to the allowance. Configuration records contractual terms only; it is not a statutory-entitlement calculation or legal-validity decision.

Opening a worker/year account resolves the latest applicable full worker override, otherwise the latest applicable workspace default, and freezes that complete policy snapshot. Later policy changes do not rewrite an opened account. Allowance changes for an opened year use append-only signed-minute adjustments with a required reason and expected account version; they never erase the configured baseline or earlier adjustments. Every Stage 1 account is labelled `policy_only` because absence accounting and historical review are not yet implemented.

Worker leave-year account ranges cannot overlap, including when a later policy changes the leave-year start date; this is enforced transactionally without rewriting existing frozen snapshots. Known stale-version, duplicate-account, overlap and policy/date mismatch refusals may return request-bound refusal codes. All other failed or malformed outcomes remain `outcome_unknown` and must not be inferred from arbitrary database text.

Canonical accounting uses integer minutes. Examples:

- `28 days` with an explicit `7.5 hours per day` conversion freezes `12,600 minutes` (`210 hours`). The displayed day figure must always explain that conversion.
- `210 hours` freezes `12,600 minutes`; hours-per-day remains recorded for explanatory day equivalents but does not alter the entered hours.
- A `+450 minute` adjustment with a reason adds `7.5 hours`; a later `-225 minute` adjustment subtracts `3.75 hours`. Both entries and the original baseline remain auditable.
- No Stage 1 account may display or imply leave taken, future leave booked or remaining to book. Those values remain unavailable until classified absences, historical review and immutable deduction postings exist.

Existing `leave` and `unavailable` records are unchanged. No record is classified, deducted or backfilled by Stage 1. Generic unavailability must never become annual leave implicitly, and bank holidays must never be deducted without a later explicit policy-aware recorded absence.

## Annual leave recording and cancellation

Stage 2 implements manager-recorded confirmed annual leave without worker requests, approvals, email or a Leave panel. A trusted owner/admin boundary records a UTC interval, while the database resolves the worker's authoritative working-pattern timezone and calculates an integer-minute intersection for every local date. Non-working dates remain immutable zero-minute segments. Ambiguous or nonexistent working-pattern times are refused rather than assigned an offset.

Every recorded date stores the account reference, working-pattern identity and revision, timezone and local-hours snapshot, policy identity and revision, frozen bank-holiday treatment, and any authoritative workspace holiday identity and revision. Later pattern, policy or holiday-calendar changes do not rewrite the calculation. Leave crossing account boundaries is split across the existing frozen accounts; missing accounts, stale account revisions, insufficient balance, assignment conflicts and overlapping leave are refused transactionally.

Workspace bank holidays are held in explicit workspace-scoped annual-leave calendars. Each calendar has a manager-recorded identity and region code; the worker is assigned to a calendar explicitly and no calendar is inferred from the working-pattern timezone. Each calendar year has its own revision and is usable only after an owner/admin explicitly confirms that exact revision as complete. Adding, changing or cancelling a holiday increments and unconfirms the affected calendar year, requiring a new confirmation before further leave can be recorded for that year. Empty years also require explicit confirmation.

No locale or provider holiday inference is used. A holiday under an `included` account policy deducts the intersected scheduled minutes; a holiday under an `additional` policy records a zero-minute holiday segment. Every newly recorded date snapshots the calendar identity, region, calendar year and confirmed year revision, including dates with no holiday. Those snapshots and previous calculation segments remain immutable after calendar edits or reconfirmation.

Recording atomically creates the confirmed absence, planner unavailability, daily calculation segments, deduction postings, account revisions, request result and audit evidence. Cancellation is terminal: it appends one exact reversal for every original deduction posting, restores each affected account by the exact recorded amount, cancels the planner unavailability and stores the cancellation request and audit in the same transaction. Identical requests replay their durable result; changed request-ID reuse is refused.

The generic unavailability path now accepts only `unavailable`. Historical generic `leave` rows remain visible and continue blocking allocation while active, but are never classified, deducted or credited. A dedicated owner/admin cancellation-only boundary may terminally cancel an active historical leave row when no Stage 2 absence/accounting record references it. That transaction preserves its interval and category, requires the current revision, records a durable identical-retry result and audit entry, and changes no account or posting. The worker panel labels this operation `CANCEL HISTORICAL LEAVE (NO BALANCE CHANGE)` and requests the normal planner refresh after confirmation.

Stage 2 leave cannot use the historical path and remains cancellable only through its exact accounting reversal. Confirmed Stage 2 leave blocks assignment through the existing planner unavailability guard; cancellation stops it blocking without cancelling or reallocating any assignment.

The recording and cancellation Edge boundaries validate authority results before presenting success. Returned account collections must contain exactly the requested account IDs once each, and every returned version must equal the caller's expected account revision plus one. Recording also requires the per-account deduction total to equal the returned total deduction. Missing, duplicate, foreign, stale or internally inconsistent account results remain `outcome_unknown`.

Remaining leave stages include worker-submitted requests, manager approval/rejection, conflict-resolution workflow, email delivery and worker self-service.

## Annual Leave Stage 3 manager UI

Stage 3 adds a dedicated `Annual Leave` view inside Scheduling while keeping the weekly planner as the default view. It is restricted by the existing Scheduling owner/admin gate and does not add forms to worker cards. Policy, account, adjustment and calendar setup remain behind clearly labelled expandable sections.

The selected worker and leave year drive all reads. The UI reads the protected Stage 1 and Stage 2 tables through their manager-only RLS policies and fails closed if account, adjustment and posting evidence does not reconcile. Allowance, signed adjustment total, net recorded leave and remaining balance are displayed in integer hours/minutes. Day equivalents use only the frozen account's explicit minutes-per-day conversion.

Policy setup supports workspace defaults or worker overrides, exact allowance units and conversion, leave-year boundaries and included/additional bank-holiday treatment. Account opening and signed, reasoned adjustments use the deployed Stage 1 authorities. Calendar setup uses explicit calendar identity and region, worker assignment, manager-recorded holiday dates and revision-bound year completeness confirmation through the deployed Stage 2 authorities.

Managers can record full-day or partial-day confirmed leave in the worker's authoritative working-pattern timezone. The browser selects the required existing account revisions but does not estimate or present a deduction; only the trusted authority result and refreshed posting evidence establish the deduction. Accounted cancellation supplies the current absence and exact affected account revisions to the exact-reversal authority. Historical leave remains clearly labelled outside balance accounting and uses only the dedicated no-balance-change cancellation authority.

Each mutation is single-flight and stores its complete workspace/user-scoped request ID and payload in session storage before invocation. Known request-bound refusals clear the pending request and refresh authoritative reads. Any transport failure, malformed response or unrecognised outcome retains the request for an explicit identical retry and blocks new annual-leave mutations. Confirmed recording and both cancellation paths emit the existing `rev-scheduling-changed` event so balances and the weekly planner refresh through their established contracts.

Manager reads use stable unique ordering and bounded pagination for every table. The UI probes beyond the 1,000-row safety limit and fails closed rather than presenting an incomplete view. An explicit refresh action performs reads only, preserves pending mutations and never retries a write automatically. Failed refreshes clear the authoritative model and block new submissions while still allowing a retained exact retry. Workspace/user scope changes invalidate in-flight reads and writes before restoring only that scope's pending request.

Accounted history is formatted explicitly with `en-GB` fields in each absence's stored timezone. Historical generic leave has no stored calculation timezone, so it is displayed in a clearly labelled current worker-pattern timezone, or UTC when no authoritative current timezone is available; it is never paired with an implicit browser-local time.

Stage 3 does not add employee self-service, leave requests, approvals, email, automatic allocation or automatic holiday inference. Manager-recorded leave is confirmed immediately.

### Leave presentation architecture

Keep Scheduling visually simple. The weekly planner remains the main and default view. The dedicated Annual Leave view contains balances, setup, calendar configuration, confirmed manager recording and protected cancellation. Worker-level cards do not duplicate these forms. The planner continues to show compact absence blocks through the existing projection. Future approval history and email status remain inside the dedicated leave view rather than expanding every worker card.

The everyday manager view uses business language only: worker and leave-year selection, day-first `Allowance`, `Used` and `Remaining` balances, `Add leave`, simple history, `Cancel leave` and `Refresh`. Day values are shown only with the frozen worker/year minutes-per-day conversion, with hours/minutes alongside; no eight-hour assumption or browser deduction estimate is permitted. Full days and custom local hours are supported. Half days remain deferred until the worker's actual saved intervals can map them without ambiguity.

Configuration is separated behind one `Leave settings` action. It is a resumable worker-specific flow: save allowance and working-day conversion, confirm the leave-year start and bank-holiday treatment, create that worker's leave year, then explicitly assign and review a holiday calendar before confirming a calendar year complete. Familiar day/hour inputs convert to exact integer minutes before invoking the existing authorities. Each confirmed response is reloaded before the next dependent step becomes available; unknown outcomes retain the exact scoped request for explicit retry and block new changes.

The settings flow never silently creates a workspace-wide policy or assigns a calendar to other workers. Holiday calendars may be shared, so the UI explains that calendar edits affect assigned workers. REV never invents holiday dates and never marks a calendar year complete automatically; managers must review the explicit date list and confirm it, and later holiday changes invalidate that confirmation through the existing authority.

### Deferred approval and email requirements

Managers may directly record and confirm leave using their workspace-scoped authority. Future worker-submitted requests require explicit manager approval before becoming confirmed leave; submitting a request alone must not reserve leave or deduct allowance.

Future leave requests require explicit manager approval or rejection with workspace-scoped authority, current-version checks, durable request identity, identical retries and append-only audit evidence. Worker access requires a separate least-privilege design and must not expose manager-only Scheduling, CRM or Business Brain data. Approval must never be inferred from an email action or delivery result.

Committed confirmed or approved leave must update the worker's balance and weekly planner together and enforce assignment-conflict checks before saving. Conflicting assignments require explicit manager resolution; confirmation must not silently overwrite or bypass them. Cancellation must retain the original evidence, append reversal postings for the original deductions exactly once, and refresh the balance and planner from the committed cancellation.

Confirmation emails may be queued only after a successful committed leave save, never before or after a rolled-back save. Durable semantic idempotency must prevent duplicate confirmations across retries and concurrent requests for the same committed leave transition. Email failure must not undo the leave save, approval, deductions or planner state.

Any future email must be separately enabled, use a verified recipient, preserve approval and content snapshots, and record durable provider states without treating provider acceptance as delivery confirmation. Approval history and email status belong in the leave panel. Failed or unknown delivery must not change leave approval, allocation or accounting state automatically. Stage 1 sends no email and creates no approval/request records.