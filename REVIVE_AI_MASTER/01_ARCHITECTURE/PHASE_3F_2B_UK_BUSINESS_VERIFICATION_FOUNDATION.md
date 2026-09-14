# Phase 3F.2B - UK Business Verification Foundation

**Date:** 2026-09-14  
**Status:** Complete foundation; real adapter prepared in Phase 3F.2C, not activated  
**External spend:** £0  
**Companies House connected:** No

## Purpose

Companies House is a verification and evidence provider, not REV's discovery engine, eligibility gate, or definition of whether a business is real. A missing registry record means only `registryVerification = not_found`; it does not imply fake business, sole trader, partnership, trading name, or poor commercial fit.

The provider-independent flow is:

`DiscoveryCandidate -> BusinessPresence -> VerificationRouter -> VerificationProvider -> Evidence/VerificationResult -> Qualification -> Contact/Opportunity`

Verification and qualification remain separate. A verified company is not automatically a good prospect, and an unverified trading presence may still be qualified when its evidence supports that decision.

## Domain model

Implemented in `revive-app/src/domain/verification.ts`:

- `BusinessIdentity`: original and normalized name, domain, location, country code, and optional postcode.
- `BusinessPresenceRecord`: workspace-scoped record of the business presence observed by REV, with a separate `BusinessEntityType` and `BusinessPresenceStatus`.
- `BusinessVerificationResult`: provider result containing registry status, match candidates, evidence, presence status, and checked time.
- `BusinessVerificationProvider` and `VerificationRouter`: provider-independent boundaries.
- `CompaniesHouseRecord`: internal adapter-shaped mock record only; the rest of REV does not depend on Companies House response structures.

### Entity types

Supported values are `incorporated_company`, `sole_trader`, `partnership`, `trading_name`, `emerging_business`, `pre_launch`, and `unknown`.

The implementation never infers an entity type from absence of a registry match. Until evidence establishes one, the entity type remains `unknown`.

### Presence states

- `registered_verified_business`: strong/exact registry evidence.
- `credible_trading_presence`: identity plus credible discovery/customer evidence, even without registry verification.
- `emerging_pre_launch_business`: reserved for future explicit evidence; never inferred automatically in this phase.
- `insufficient_evidence`: identity or supporting evidence is incomplete.

### Verification states and match strengths

Verification states include `verified`, `partially_verified`, `not_found`, `ambiguous`, `conflicting_evidence`, `evidence_required`, and `not_applicable`. Match strengths include `exact`, `strong`, `possible`, `ambiguous`, and `no_match`.

The deterministic mock matching rules are:

1. Normalize names to lowercase alphanumeric identity, converting `&` to `and`.
2. Compare exact normalized names.
3. Compare compatible name variants where one normalized name contains the other.
4. Extract and compare UK postcodes when available in candidate location evidence.
5. Exact name plus postcode is `EXACT`.
6. Exact name alone, or compatible name plus postcode, is `STRONG`.
7. Compatible name without location confirmation is `POSSIBLE`.
8. More than one plausible match is `AMBIGUOUS`; no company number or entity type is selected automatically.
9. No matches is `NOT_FOUND`; entity type remains `UNKNOWN`.

Opaque AI matching is not used.

## Evidence and provenance

Evidence reuses the existing typed evidence model and preserves `FACT`, `INFERENCE`, and `EVIDENCE_REQUIRED` distinctions. Verification facts carry provider key, source, optional source reference, observed time, and match reasoning. Raw provider payloads are not stored. Provider identifiers are retained only inside the verification result boundary and require provider-specific retention approval before persistence.

Future sources can contribute evidence through the same model: discovery provider, business website, directory, customer-provided information, professional social presence, tender/procurement source, or business email domain. None of those sources is connected here.

## Companies House role and trusted execution

The mock implementation is `MockCompaniesHouseVerificationProvider` in `revive-app/src/services/businessVerificationService.ts`. The real server-only adapter is `revive-app/src/server/companiesHouseVerificationProvider.ts`; it is tested with injected responses but has no credential, API call, Edge Function deployment, or browser call.

The future real provider must execute in a trusted server boundary, after authenticated identity and active workspace membership have established workspace context. It must apply workspace/platform cost limits, rate limiting, idempotency, retention policy, and audit logging. It must not modify or reuse the legacy `telegram-alert-ts` infrastructure.

## Persistence decision

No new persistence is required for this architecture-first phase. A future schema may need workspace-scoped `business_presence`, `business_verifications`, `business_evidence`, and provider-event records, but that would require a separate local migration proposal covering composite tenant keys, RLS, immutable workspace identity, retention classification, deletion/retention policy, indexes, and numeric/time precision. No migration was created or applied here.

Until that review occurs, verification results remain service/test objects and do not write Contact, Opportunity, Business Memory, or revenue records.

## Product boundaries

- `REV FIND`: future capability for finding new money outside the business, including prospects, tenders, contracts, grants, partnerships, and emerging businesses.
- `REV RECOVER`: future capability for finding money/opportunities already inside the business, including dormant leads, forgotten quotes, stalled opportunities, unpaid invoices, and former-customer reactivation.
- `MONEY REV FOUND`: future first-class metric for identified potential/recoverable value. It is never `WON REVENUE`.
- Goal-based orchestration remains the north star: the owner states the commercial outcome and REV chooses the required capabilities underneath.
- Future autonomy remains configurable as `ALWAYS ASK`, `TRUSTED ROUTINE ACTIONS`, and `ASK ABOVE THRESHOLD`.
- Future Owner Control Centre and REV Voice remain roadmap items, with approval, consent, compliance, recording, retention, and audit requirements.

## Validation

`revive-app/src/tests/phase3f2b_verification.test.ts` covers exact, strong/ambiguous, not-found, non-registered, emerging/pre-launch, unknown entity handling, presence evidence, non-qualification, non-revenue, GB boundary, and mock-only behavior. Full app validation remains required after this phase's final edit.

## Stop gate

Do not connect Companies House yet. Do not connect discovery, enrichment, paid AI, outreach, or revenue recovery. Do not apply a production migration. The next safe step is review of this architecture and an explicit decision on whether a trusted server-side verification handler and local persistence proposal are warranted.
