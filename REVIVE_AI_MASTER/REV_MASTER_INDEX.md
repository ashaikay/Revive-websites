# REV Master Index — 19 October 2026

## Authoritative sources
- Product decisions and prioritised tasks: [REV Notion Hub](https://app.notion.com/p/3fe24045d8b68148990bc85188eb4548)
- [REV Action Register](https://app.notion.com/p/15e18ce6811c47069f3ebefad2faa8db)
- Existing engineering documentation: `REVIVE_AI_MASTER/`
- Application: `revive-app/`

## Commercial MVP scope
1. Employment programmes: My Caseload, Find Jobs, Employers, vocational profiles, eligibility, reporting.
2. Workforce and job scheduling: assignments, leave, sickness, recovery and audited meeting confirmation.
3. REV Brain, Growth and Outlook: discover lead, verify and qualify, prepare outreach, human approve, send, monitor replies, book confirmed meeting, follow up, record outcome.

Do not enlarge the near-term MVP with a full accounting product, general website generator, or autonomous SEO autopublishing.

## Trust and release rules
- Tenants and roles are isolated with tested RLS.
- Outbound email requires authorisation, correct provider identities, suppression and idempotency.
- Meeting proposals are not provider-confirmed events.
- Vocational and employment details require authorisation, evidence and safeguards.
- Only label tasks completed after merged code, migrations and test evidence.

## Local vs remote caveat
Historical chat may refer to local Windows working tree/migrations not yet pushed. The code in this repository must be inspected before declaring deployment status.

## Handoff
Start at the Notion task register, select critical P0 tasks and map each to a GitHub issue, code path, migration, tests and a verified release check. Preserve the existing `REVIVE_AI_MASTER/` architecture.
