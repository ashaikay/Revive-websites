# Hosted vocational schema reconciliation — 23 October 2026

User supplied catalog export after hosted migration push stopped with 42P07.
History confirms reminder delivery and scheduling import recorded as applied.
No subsequent production mutation has been performed by this review.

## Comparison

Built a separate local database `rev_schema_review`, with local auth/storage
schema prerequisites and repository migrations through `20261019013000`.
Compared all eight tables (columns/defaults/nullability, constraints, indexes,
triggers, RLS flags and ACLs), two policies and twelve functions against the
user-supplied JSON. Sorted unordered catalog arrays and collapsed whitespace;
normalized local supabase_admin ownership to hosted postgres for comparison.

All table and policy metadata matched. Eleven function definitions matched.
The hosted section validator lacked null-safe required-field checks, an explicit
missing-type rejection, and string/nonblank choice-option checks already in the
repository. Six functions had additional service_role EXECUTE grants. The
validator and version-insert trigger helper additionally allowed authenticated
EXECUTE, unlike the repository. No unexpected anonymous grant was found in
this export. Scope is the exported vocational objects, not a whole-project audit.

## Prepared correction and validation

`revive-app/supabase/reconciliation/20261023_vocational_existing_schema.sql`
is a manually reviewed reconciliation script outside automatic migrations.
It checks MD5 fingerprints of the two affected live definitions against the
supplied export before any changes. It uses a transaction and short timeouts,
replaces only the validator body with the repository version, and revokes
PUBLIC/anon/authenticated EXECUTE on the validator and trigger helper.
Existing service_role access is retained. No table, row, policy, trigger,
migration-history entry or provider configuration is rewritten.

In the isolated database, restored the supplied hosted function bodies and
helper grants. Nine validator cases showed six malformed cases accepted before
correction and rejected afterward: missing label/required/sensitive/type, blank
choice option, numeric choice option. Valid short-text/choice and empty sections
remained accepted. Four anon/authenticated helper permission checks passed.
Reapplying the script failed its changed-definition guard as intended.
All nine later migrations (`20261019020000` through `20261021002000`)
applied successfully to this corrected isolated baseline. No live rows were
copied or used. This does not establish compatibility with every live record.

## Next steps

Apply the guarded correction through SQL Editor only after reviewing the script,
and supply its result. Then verify definitions/permissions before deciding on
history repair for `20261019010000`, `20261019011000`, `20261019012000` and
`20261019013000`. The latter is explicitly a local parity snapshot and should
not be executed against hosted tables. Do not mark any of the nine later
migrations applied: the exported matching/consent objects are absent.
Do not retry the bulk push or drop/recreate tables to bypass the conflict.
No function deployment or frontend release has occurred in this step.

## User-supplied post-correction verification

The user reported SQL Editor returned no rows, then supplied two successful
permission checks: authenticated cannot execute either internal helper. Raw
MD5 comparison to the local validator returned false. The subsequently supplied
full `pg_get_functiondef` shows the intended strict validator body with CRLF
line endings inside its dollar-quoted body, whereas the local baseline uses LF.
The displayed code has the null-safe checks, missing-type rejection and choice
option validation intact. Windows line endings explain the raw fingerprint
mismatch; they do not change this function's SQL semantics. Future comparisons
should normalize CRLF before fingerprinting, not weaken semantic validation.

The four baseline migrations can now be reconciled in recorded history:
`20261019010000`, `20261019011000`, `20261019012000`, `20261019013000`.
This records existing and compared effects, including the targeted correction;
it must not execute the local parity snapshot on hosted tables. The command
syntax was checked against CLI 2.117.0 `migration repair --help`. It changes
migration metadata, not application records or object definitions. After its
success, obtain a new `db push --dry-run --include-all --skip-vault` plan and
require exactly the nine later migrations. No repair has run from cloud.
