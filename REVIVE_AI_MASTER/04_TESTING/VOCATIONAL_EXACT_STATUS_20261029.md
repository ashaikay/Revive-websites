# Selected questionnaire status

The profile opens a specific questionnaire snapshot, but the former status endpoint independently selects a participant assessment using template publication state and ordering. With multiple versions it can return another assessment. The frontend correctly refused to display that mismatched result, but closing and reopening could not resolve the underlying selection difference.

Added `rev_voc_assessment_selected_status` with explicit assessment ID and matching workspace, programme and participant predicates. It uses the existing assessment authorisation and ordinary-question classifier, returns no answers, and refuses missing or foreign assessments. The existing overview endpoint remains unchanged for caseload summaries. The open profile now requests the selected assessment's status and still suppresses stale or mismatched responses.

Validation: 15 focused UI tests pass; Supabase-mode production build passes. Applied the additive migration to the isolated local database and ran the rollback-only lifecycle test with two assessment snapshots, explicit historical selection, manager and assigned adviser access, foreign programme denial, and consent/access lifecycle checks. Hosted migration and preview verification remain pending.

Deployment: apply only `20261029001000_rev_voc_selected_assessment_status.sql` after the prior status-reader migration. Frontend preview will report unavailable status until that RPC exists. No answers or existing assessments are changed. The user-pasted screen still showed Mike and manager controls, so Robert's staff experience has not yet been verified.
