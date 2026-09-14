# Phase 3F.2C - Controlled Companies House Verification

**Date:** 2026-09-14  
**Result:** PASS; trusted handler deployed and one corrected real verification succeeded  
**External spend:** £0

## Official documentation

Reviewed the current Companies House Developer Hub documentation:

- [API overview](https://developer.company-information.service.gov.uk/overview/)
- [Authentication](https://developer.company-information.service.gov.uk/authentication/)
- [Developer guidelines](https://developer.company-information.service.gov.uk/developer-guidelines/)
- [Get started](https://developer.company-information.service.gov.uk/get-started/)
- [API specifications](https://developer-specs.company-information.service.gov.uk/)

Confirmed: API-key HTTP Basic Auth uses the API key as the username and an ignored blank password; OAuth is a separate user-authorized option. The public REST API is read-oriented for this use and requires TLS. The documented default rate limit is 600 requests per five minutes, with HTTP 429 for excess requests. The official setup path is to register a Companies House user account and create an API key/application through the Developer Hub. No payment requirement was identified in the current official developer documentation.

Companies House public-register reuse remains subject to Crown copyright/Open Government Licence and applicable API/reuse terms. The adapter retains only normalized company facts and provenance; it does not retrieve officers, PSC, or personal addresses. A legal/reuse review remains required before durable production persistence.

## Implementation

- `revive-app/src/domain/verification.ts` now permits asynchronous trusted providers while preserving the existing mock contract.
- `revive-app/src/services/businessVerificationService.ts` reuses the deterministic matcher and now recognizes an exact company-number signal.
- `revive-app/src/server/companiesHouseVerificationProvider.ts` implements the real provider boundary. It is server-only, uses Basic Auth, enforces `GB` before any call, queries only `/search/companies`, normalizes company number/name/status/address/postcode/SIC facts, and excludes raw payloads and personal data.
- Provider failures are distinct from `NOT_FOUND`: authentication, rate limit, unavailable, malformed response, and no-match states are separately represented.
- `MockCompaniesHouseVerificationProvider` remains the deterministic development provider. Real failures never fall back to mock data.

## Trusted execution and tenant boundary

The repository is a Vite browser application, so the provider remains unimported by React. The independent `rev-business-verify` Edge Function authenticates the caller, derives active workspace membership through the RLS-scoped client, applies bounded in-memory workspace/platform rate and idempotency controls, calls the provider, and returns only sanitized results. It does not modify or reuse `telegram-alert-ts`.

The API key is configured only as the Supabase server-side secret `COMPANIES_HOUSE_API_KEY`; its value was never read into client code, output, or logs. It must remain outside `VITE_*`, source control, browser storage, Contact/Opportunity metadata, Business Memory, audit payloads, and prompts.

## Verification boundaries

- `GB` requests are eligible for the provider; non-GB requests return `NOT_APPLICABLE` before fetch.
- Exact company number, exact normalized name plus postcode, and other explainable name/postcode signals are supported.
- Multiple plausible records remain `AMBIGUOUS`; no first result is silently selected.
- No match returns `NOT_FOUND` with `entityType = UNKNOWN` and preserves credible trading presence.
- Verification does not create a Contact, Opportunity, revenue, attribution, or outreach action.
- Verification is evidence, not qualification and not proof that a business exists or does not exist.

## Validation

- Focused verification and adapter tests: 12/12 passed.
- Full application suite: 81/81 passed.
- Production build: passed.
- `npm audit`: 0 vulnerabilities.
- One corrected real Companies House profile call succeeded; total provider calls were 7 including six earlier HTTP 400 attempts. External spend was £0.
- No provider credential value was exposed. No database, migration, Contact/Opportunity, revenue, outreach, legacy quote/Telegram, or marketing-site change occurred.

## Controlled deployment and test result

The independent `rev-business-verify` Edge Function was deployed with `verify_jwt = true` to the existing Revive project. The server-side `COMPANIES_HOUSE_API_KEY` secret was available to the function without being exposed. User A authentication and active workspace membership passed; anonymous requests were denied with 401, and cross-workspace/outsider requests were denied with 403.

Non-GB returned `NOT_APPLICABLE` with zero provider calls. Six initial bounded GB calls returned sanitized HTTP 400. The defect was corrected by trimming the key and encoding `API_KEY:` through a tested GET/no-body builder. Exactly one permitted real profile retest for company `00000006` returned `VERIFIED / EXACT`. Total real provider calls: 7. No further calls were made.

## Stop decision

Phase 3F.2C is complete PASS for the bounded real verification proof. The trusted boundary, auth, workspace authorization, GB gate, request controls, secret isolation, normalization, and one real exact verification passed. Stop here: do not continue into discovery, enrichment, or outreach. External spend was £0 and no database, legacy, or commercial side effect occurred.
