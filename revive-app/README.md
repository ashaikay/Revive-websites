# REV App

## Provider modes

The app defaults to mock mode:

```env
VITE_REV_PROVIDER_MODE=mock
```

Opt into the Phase 2D.2 read-only Supabase path with a local, gitignored `.env.local`:

```env
VITE_REV_PROVIDER_MODE=supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Supabase mode loads the authenticated session, active workspace memberships, workspace switching, and read-only Business Brain/profile data. Goals, contacts, REV actions, approvals, Business Memory, audit, membership changes, and all other writes remain outside this integration step.

Privileged credentials are never accepted by the browser client.
# REV Local Application

Phase 2B prepares REV for a future real multi-tenant data connection without activating external infrastructure.

## Local URL

`http://127.0.0.1:5180/`

The Vite server is configured with `strictPort: true`. If port 5180 is occupied, startup fails instead of moving to another port.

## Current Mode

- Development / mock authentication only
- Workspace-aware local mock provider
- Mock AI orchestration only
- No Supabase client or network connection
- No email, SMS, WhatsApp, voice, calendar, payments, scraping, or external execution

## Architecture

`UI -> application services -> repository interfaces -> mock provider`

The future connection point is `src/data/supabaseAdapter.ts`. It intentionally throws in Phase 2B until the frozen dedicated Revive Supabase project is inspected and explicitly approved for reactivation.

## Commands

```text
npm run dev
npm test
npm run build
npm audit
```

## Official UK bank holidays (Annual Leave)

Leave settings now offers: choose England and Wales, Scotland or Northern Ireland
and a year, load official GOV.UK dates, review the full list and preserved manual
dates, then confirm. A new regional calendar and worker assignment are created
only on confirmation when needed. Existing shared calendar changes affect every
assigned worker. Technical/manual calendar controls remain under Leave settings.

The `rev-annual-leave-bank-holiday-import` Edge Function fetches only
`https://www.gov.uk/bank-holidays.json`, with a timeout, bounded response and
strict event validation. Missing years are refused without calculating dates.
An immutable server-side preview records source, region, dates and fetch time.
Confirmation uses that snapshot, never a second fetch or browser-provided dates.
Manual same-date entries (including identical titles), cancelled entries, changed
imported entries and previously imported dates absent from the new official list
are reported as conflicts, not overwritten. Additional manual dates are preserved
and shown for review.

Migration `20261007000000_rev_official_bank_holiday_import.sql` adds three private
snapshot/provenance/exact-retry tables and a service-role-only import function.
It reuses workspace serialization, active manager checks, tenant-scoped calendar
authority, holiday saves, revision invalidation, year confirmation and auditing
in one atomic transaction. Stale reviews and conflicts cannot confirm completeness.
No existing leave calculation, posting or balance is recalculated. There is no
background scheduler or new dependency. Hosted application is a separate,
explicitly authorised operation.

Focused checks:

```text
node --experimental-strip-types --test supabase\functions\rev-annual-leave-bank-holiday-import\bankHolidayImportBoundary.test.ts
npm test -- src/tests/officialBankHolidayImportUI.test.tsx src/tests/annualLeaveStage3LifecycleUI.test.tsx src/tests/annualLeaveStage3InteractionUI.test.tsx src/tests/annualLeaveStage3UI.test.tsx
npx tsc --noEmit
npm run build
git diff --check
```

For local database checks only, apply the migration to the existing local stack,
then pipe `src\tests\official_bank_holiday_import_local.sql` to its PostgreSQL
container with `psql -v ON_ERROR_STOP=1`. The test uses disposable workspace
fixtures and rolls back everything; it requires an existing local active owner.

## Database Preparation

The Supabase-compatible migration files are under `supabase/migrations/`. They are preparation artifacts only and have not been applied remotely. Before Phase 2C:

1. Inspect the existing dedicated Revive Supabase project tables, functions, RLS, storage, and auth state.
2. Reconcile the prepared migration against that inspected schema.
3. Run cross-tenant RLS tests against a non-production environment.
4. Obtain explicit approval before any remote change.

Never create a new Supabase project and never use FatherLegacy/MotherLegacy projects for this application.

## Dependency Audit

Phase 2A reported 10 development-toolchain vulnerabilities. Vite, Vitest, and TypeScript ESLint were upgraded in Phase 2B; `npm audit` now reports 0 vulnerabilities. Node 20.18.0 emits an engine warning for one package preferring Node 20.19+, so Node should be upgraded before production tooling is introduced.
