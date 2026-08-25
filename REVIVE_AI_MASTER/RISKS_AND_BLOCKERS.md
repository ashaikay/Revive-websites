# Risks and Blockers

## Current risk profile
- The public website is active and must not be damaged by any future work.
- Generic starter template text still exists and should be replaced carefully when the brand is finalized.
- Client config contains a Supabase anon key; treat it as a visible client-side secret and never expose it in documentation or logs.
- There is no secure customer-authenticated platform yet.
- No tenant isolation or RBAC model exists yet.
- No production-grade AI gateway, sandbox, or billing system exists.

## Blockers
- None preventing baseline documentation and Phase 1 architecture planning.
- No destructive actions or production deployment work are underway.

## Safety requirements
- Keep marketing and customer data separated.
- Never execute untrusted generated code in the primary Revive environment.
- Do not trust frontend-supplied billing or credit state.
- Do not add any customer or business data processing before architecture is defined.
