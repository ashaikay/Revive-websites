# REV Phase 2D.2 Integration Report

**Date:** 2026-09-12
**Project:** Revive Websites
**Project ref:** `ntbowgutwyyhhnmkadlv`
**Status:** Initial read-only Supabase integration complete

## Delivered

- Preserved mock mode as the default provider mode.
- Added opt-in `supabase` mode through `VITE_REV_PROVIDER_MODE`.
- Added a browser-safe Supabase client using only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Added Supabase auth session initialization, auth-state subscription, sign-in, and sign-out behind the auth boundary.
- Added live authorized workspace loading from active memberships only.
- Rejected invalid workspace switches through the centralized store.
- Added read-only Business Brain/profile and active services loading through the Supabase repository layer.
- Kept goals, contacts, REV actions, approvals, Business Memory, audit, membership changes, and all writes out of live mode.
- Kept React components free of direct Supabase imports.

## Configuration

Mock mode remains the default:

```env
VITE_REV_PROVIDER_MODE=mock
```

Supabase mode requires a local gitignored `.env.local` containing only:

```env
VITE_REV_PROVIDER_MODE=supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

No privileged credential is accepted by the browser client.

## Validation

- Existing tests: 15 passed, with added provider-scope and credential-boundary coverage.
- Production build: passed.
- Dependency audit: 0 vulnerabilities.
- No database migration created.
- No RLS, policy, function, quote, Telegram, or marketing-site changes.
- Frontend live mode was not enabled by default.

## Live validation boundary

The live RLS harness already verified tenant isolation before this integration. A minimal browser login/sign-out surface is now present in Supabase mode. The exact shared page at `http://127.0.0.1:5180/` remained at the login form during validation; the reported authenticated footer was on an unshared browser context and could not be verified. User A/B/C browser validation, logout isolation, and stale-workspace browser checks therefore remain pending.

## Remaining work

Live writes and all operational repositories remain mock-backed or disabled. Do not connect the frontend broadly until the read-only mode is reviewed and approved.
