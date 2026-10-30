# Sensitive support permissions panel

The former panel offered writes without reading consent or grants. It also hid structured RPC errors behind a generic unconfirmed message. The revised panel reads permission metadata before enabling changes and separates ordinary vocational completion from optional sensitive support.

New migration: `20261029000000_rev_voc_support_access_status.sql`. The SECURITY DEFINER read uses the same authenticated owner/admin and assessment-authorisation checks as the existing write functions. It returns the requested assessment ID, its consent state and active participant-level adviser grant IDs only. It returns no answers, consent statements, evidence, or purpose text. Direct table permissions remain unchanged.

The UI blocks duplicate grants and recording over existing consent. Existing grants for former advisers can be revoked. A grant is described as recorded permission, not proof of effective access; current consent and active assignment remain server requirements. Withdrawn consent cannot be reinstated through this panel. Read failures are never shown as absent consent. Lost write responses pause changes until a fresh metadata check; there is no automatic write replay. Scope changes suppress stale reads and writes.

Validation: six focused consent UI tests pass, plus fifteen assessment/status tests passed alongside the first five consent tests. Default and Supabase-mode builds pass. Applied the migration to the isolated local Supabase database and ran the rollback-only consent lifecycle integration test, extended with manager status, adviser denial, foreign-workspace denial, granted and withdrawn status and metadata-only assertions; passed. Hosted migration/deployment and authenticated preview checks remain outstanding. PR #4 remains unmerged.

Deployment order: apply the reviewed migration, then deploy the updated frontend preview. Without the RPC, the panel deliberately pauses writes and offers a status retry. This change does not determine the outcome of the user's earlier hosted grant; a successful hosted status read is still required.
