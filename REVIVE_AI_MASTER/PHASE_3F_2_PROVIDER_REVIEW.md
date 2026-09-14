# Phase 3F.2 DataForSEO Provider Review

**Date:** 2026-09-14  
**Provider:** DataForSEO Business Data / Business Listings API  
**Review status:** Technical adapter prepared; real credentials and paid execution intentionally blocked

## Official documentation reviewed

- [Business Listings overview](https://docs.dataforseo.com/v3/business_data/business_listings/overview/)
- [Live Business Listings Search](https://docs.dataforseo.com/v3/business_data/business_listings/search/live/)
- [Locations](https://docs.dataforseo.com/v3/business_data/business_listings/locations/)
- [Authentication](https://docs.dataforseo.com/v3/auth/)
- [Business Listings pricing](https://dataforseo.com/pricing/business-data/business-listings-api)
- [Terms of Service](https://dataforseo.com/terms-of-service/)
- [Privacy Policy](https://dataforseo.com/privacy-policy/)

## Findings

- Endpoint: `POST https://api.dataforseo.com/v3/business_data/business_listings/search/live`.
- Request shape: JSON array containing one task. The endpoint supports `location_name`, optional `categories`, `limit` up to 1000, and `location_coordinate` when coordinates/radius are intentionally supplied. The adapter uses `location_name` and does not invent radius semantics.
- Authentication: HTTP Basic Auth using the DataForSEO API login and generated API password, Base64 encoded in the `Authorization` header. These are not the DataForSEO account password and must remain server-side.
- UK support: the official locations endpoint supplies ISO country codes and the Business Listings API is global. REV V1 deliberately allows only `GB` at the service/provider boundary; non-GB requests return `International discovery is coming soon.` before provider execution.
- Rate limits: official search documentation states up to 2,000 API calls per minute and at most 30 simultaneous calls for the Live endpoint. REV must apply a stricter application/global limiter before execution.
- Pricing: the official Business Listings pricing page currently states `$0.012` per Live task plus `$0.00036` per returned item; both setting a task and receiving results are billable. DataForSEO's general pricing page states a minimum payment amount of `$50`.
- Retention: DataForSEO's published Privacy Policy says it stores DataForSEO API task data for 365 days and permanently deletes data stored longer than 365 days. This is not a blanket authorization for REV to retain raw provider payloads. The adapter persists only normalized permitted facts/provenance and explicitly sets `rawPayloadStored: false`; legal/data-licensing approval remains required before production persistence.
- Terms: the Terms of Service warn that repeated identical tasks consume resources and may not be refunded, so request idempotency and rate limiting are mandatory. The Terms also restrict use of provider-origin SERP data in ways that compete with or adversely affect originating search providers; the intended REV use requires product/legal review before paid activation.

## Architecture decision

The existing browser-only Vite app has no trusted server execution boundary. A DataForSEO adapter must therefore run only in a trusted backend/Edge Function boundary. The server-only module at `revive-app/src/server/dataForSeoBusinessDiscoveryProvider.ts` is not imported by the browser entrypoint and accepts credentials only through a server-provided configuration object. It injects `fetch` for tests, normalizes the response, excludes raw payloads and personal contact enrichment, and maps provider failures without logging credentials or response bodies.

A production boundary still needs a deployed trusted handler that authenticates the REV user, derives active workspace membership, applies workspace and global CostGovernor decisions, enforces request idempotency and rate limits, invokes this adapter, and records usage. No such handler is deployed in this phase.

## Cost and credential gate

No `DATAFORSEO_*` credentials or `REV_PROVIDER_TEST_BUDGET_GBP` configuration were present in the local environment. No real API request was made and no account, deposit, or paid service was activated. Before any real request, Mike must create/authorize the DataForSEO account, review the current pricing/terms, configure the generated API login/password directly in the trusted server environment, and set a development ceiling at or below `£10`; credentials must never be pasted into chat, committed, exposed via `VITE_*`, or sent by the browser.

## Stop decision

Phase 3F.2 stops at the credential/setup and trusted-boundary gate. The deterministic mock provider remains active, no DataForSEO adapter is wired into GROWTH, no contact enrichment or outreach is connected, no AI provider is connected, and no database migration or remote Supabase change is authorized.
