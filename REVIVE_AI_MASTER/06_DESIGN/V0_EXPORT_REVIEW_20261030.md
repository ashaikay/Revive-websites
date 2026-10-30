# v0 export comparison

Reviewed user-uploaded rev-business-hub-prototype.zip. Static source inspection only; v0's claimed build/browser results were not independently rerun. No application changes or deployment.

## Finding

Useful visual reference, not a replacement application. Source has three components files (fixtures, dashboard, button) plus stylesheet/app scaffolding. Several named pages share a generic list and no-op dialog. The user correctly identified substantial missing workflows.

| Area | Export evidence | Existing REV boundary to retain |
| --- | --- | --- |
| Calendar month | Non-week views both render agenda rows; Month only changes heading. | SchedulingWeeklyPlanner computes actual month days and entries. |
| Dates | moveDate selects one of two fixed strings; weekday labels are inconsistent with 2026. | Existing planner date helpers and timezone-aware navigation. |
| Time/status | Fixed sample start labels, fixed summary counts and conflicts; no saved-read freshness. | Start/end times, display timezone, 30-second refresh and last-successful-update timestamp, stale/error messages. |
| Worker management | Two fictional workers and a filter. | Worker creation/editing, roles/skills, archive/restore, working patterns and unavailability. |
| Leave | Static unavailable shift. | AnnualLeaveView and WorkerUnavailabilityPanel including sickness, cancellation and existing permission rules. |
| Job management | Add job/shift opens the shared no-op modal. | SchedulingJobsPanel, JobAssignmentsPanel, requirements/suitability and confirmation/cancellation/retry logic. |
| Documents | Absent from scheduling. | SchedulingJobDocumentsPanel. |
| Reporting / transfers | Absent. | SchedulingReportingPanel / SchedulingTransfersPanel through existing scheduling composition. |
| Programme Hub | Profile and builder buttons open no-op dialogs. Notes are the same demo array across records; selected record is not reset when programme changes. Builder section remains displayed in staff mode. | ProgrammeHubModule and ParticipantVocationalAssessment; scoped notes, exact retries, real role gates, assessment versions and consent boundaries. |
| Navigation | active state changes locally; unsupported top-level views fall through to dashboard; workspace/account controls are decorative. | Navigation + App + WorkspaceModuleGate, real workspace/account props and existing hash routes. |
| Employer / matching / Outlook | Generic lists and sample modals. | Existing module workflows and review/approval/provider gates; demo statuses do not establish implementation. |

## Compatibility

Export: Next 16 / React 19 / Tailwind 4, lucide icons and Vercel analytics. REV: Vite 6 / React 18 / Tailwind 3. Do not copy package.json, app routing, fixtures or analytics into REV. Adapt useful tokens, spacing, cards, typography and shell components to the existing stack. Mobile dialogs/drawer also need keyboard/focus validation before adoption.

## Next integration increment

Use a separate branch based on the verified merged production commit. Review the user's local Navigation.tsx and rev-premium-navigation.css changes first; they are not in this checkout. Integrate shell/navigation styling with actual permitted routes, workspace selector, account identity and sign-out callback. Retain existing module bodies. Then style the real scheduling controls and calendar without replacing their data or logic. Review desktop/mobile and relevant regressions before merging. No redesign rollout has been approved or performed by this document.
