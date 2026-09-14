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

## Database Preparation

The Supabase-compatible migration files are under `supabase/migrations/`. They are preparation artifacts only and have not been applied remotely. Before Phase 2C:

1. Inspect the existing dedicated Revive Supabase project tables, functions, RLS, storage, and auth state.
2. Reconcile the prepared migration against that inspected schema.
3. Run cross-tenant RLS tests against a non-production environment.
4. Obtain explicit approval before any remote change.

Never create a new Supabase project and never use FatherLegacy/MotherLegacy projects for this application.

## Dependency Audit

Phase 2A reported 10 development-toolchain vulnerabilities. Vite, Vitest, and TypeScript ESLint were upgraded in Phase 2B; `npm audit` now reports 0 vulnerabilities. Node 20.18.0 emits an engine warning for one package preferring Node 20.19+, so Node should be upgraded before production tooling is introduced.
