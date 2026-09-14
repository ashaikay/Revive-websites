# Phase 3F.2A - UK Discovery Provider Comparison

**Date:** 2026-09-14  
**Decision:** Research and architecture only. No provider was connected, funded, called, or integrated.

## Executive conclusion

No reviewed provider satisfies all REV requirements at once.

- **Best cheap discovery test:** Outscraper, because its official Google Maps Scraper page advertises the first 500 businesses free and pay-as-you-go pricing. It still requires a payment method before first use under its Terms, and the accessible terms do not clearly grant REV permanent CRM-style retention of Google-derived records. It remains a scraping intermediary, so it is not approved for integration.
- **Best persistent verification source:** Companies House, for incorporated UK companies. The API is government-operated, free to use, has a documented 600 requests/5 minutes limit, and returns company numbers and registered-office data. It is not a replacement for local-business discovery because it does not cover every trading business, sole trader, or Google-listed SME.
- **Best long-term architecture:** a two-source design: a legally cleared POI/business-discovery provider for candidate discovery, followed by Companies House verification only where a limited-company match exists. REV retains only provider-permitted normalized facts and provenance; personal contact enrichment remains a later phase.
- **DataForSEO:** technically strong and already has a server-only adapter, but the published `$50` minimum payment conflicts with the current no-funding decision. Do not pay for it merely to test.
- **Google Places:** strong technical coverage and useful free monthly SKU allowances, but not suitable as the sole persistent CRM source under the current Google Maps license restrictions. Place IDs may be stored indefinitely; the current terms prohibit exporting, bulk downloading, copying/saving business names or addresses, caching, and creating a listings/directory product from Places content.

Prices below are provider-published USD figures unless stated otherwise. No GBP conversion is assumed because exchange rates and taxes are variable.

## Official sources reviewed

- [DataForSEO Business Listings Live](https://docs.dataforseo.com/v3/business_data/business_listings/search/live/)
- [DataForSEO Business Listings pricing](https://dataforseo.com/pricing/business-data/business-listings-api)
- [DataForSEO authentication](https://docs.dataforseo.com/v3/auth/)
- [Google Places Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Google Places pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Google Places usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
- [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms)
- [Google Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id)
- [Outscraper Google Maps Scraper](https://outscraper.com/google-maps-scraper/)
- [Outscraper pricing](https://outscraper.com/pricing/)
- [Outscraper Terms](https://outscraper.com/terms-of-service/)
- [Serper](https://serper.dev/)
- [Serper Terms](https://serper.dev/terms)
- [Serper Privacy](https://serper.dev/privacy)
- [Companies House API overview](https://developer.company-information.service.gov.uk/)
- [Companies House authentication](https://developer.company-information.service.gov.uk/authentication/)
- [Companies House developer guidelines](https://developer.company-information.service.gov.uk/developer-guidelines/)
- [Foursquare Place Search](https://docs.foursquare.com/fsq-developers-places/reference/place-search)
- [Foursquare Places pricing](https://foursquare.com/pricing/#places_api)
- [Foursquare terms index](https://foursquare.com/legal/terms)

## Provider findings

### A. DataForSEO Business Listings

- **Coverage/search:** Global Google Maps business listings; categories, address, city, postcode, country, website/domain where returned, phone, ratings, and provider identifiers such as `place_id`/`cid`. Appropriate endpoint is `POST /v3/business_data/business_listings/search/live`.
- **UK:** Supported through the provider's location catalogue; location-name searches can target Birmingham, B1, and similar locations. Radius can be represented only where the provider's documented coordinate format is used.
- **Auth/server suitability:** Basic Auth with generated API login/password; server-side only.
- **Cost:** Published `$0.012` per task plus `$0.00036` per item. Approximate API usage cost: 10 items `$0.0156`, 100 `$0.048`, 1,000 `$0.372`, before taxes/FX. Account funding minimum is published as `$50` on the general pricing page.
- **Rate limits:** Up to 2,000 calls/minute and 30 simultaneous calls for Live Business Listings; REV should impose lower limits.
- **Persistence/licensing:** DataForSEO Privacy Policy states API task data is retained for 365 days by DataForSEO. This does not itself establish REV's right to retain raw Google-derived data indefinitely. Store only normalized facts after written licensing review; never store raw response payloads or personal contact enrichment by default.
- **Main risk:** Upfront funding conflicts with the current decision. Google-origin data and retention/licensing need explicit approval.

### B. Google Places API (New)

- **Coverage/search:** Excellent global POI coverage. Text Search (New) supports category/text queries, location bias/restriction, place IDs, display name, address, types, and website URI depending on requested fields. Text Search returns at most 60 results across pages.
- **UK:** Supported; `regionCode` uses CLDR and `GB` is the relevant region code. Billing account and API key/OAuth are required.
- **Cost:** Current global pricing lists monthly free usage caps by SKU. IDs-only Text Search and Place Details are listed as unlimited free; fields such as display name, formatted address, types, and website URI trigger higher SKUs. Current pricing tables show free caps of 5,000 events for Pro and 1,000 for Enterprise classes, with published list rates such as `$32/1,000` for Text Search Pro-equivalent pricing and `$35/1,000` for Enterprise-equivalent pricing after the free cap. Exact cost depends on the field mask, so 10/100/1,000 business estimates are `$0` only when usage remains under the applicable monthly free cap and the requested fields/SKU are confirmed. This is not a guarantee of zero billing.
- **Upfront/payment:** Billing must be enabled. The official docs do not promise a no-card, no-billing-account path for production Web Service use.
- **Rate limits:** Per-minute quota is per API method per project; quota is configured in Google Cloud and must be capped by REV.
- **Persistence/licensing:** Google explicitly exempts Place IDs from caching restrictions and allows indefinite Place ID storage. The Maps Platform Terms prohibit exporting/extracting Places content for use outside the Services, pre-fetching/indexing/storing/resharing/rehosting it, bulk downloading places information, and copying/saving business names or addresses. Therefore Google alone cannot be treated as a persistent REV business directory/CRM source. Attribution and Google Maps visual separation requirements also apply.
- **Main risk:** Best discovery quality, poor fit for durable Contact/Evidence/Business Memory persistence. A Google Place ID may be retained as a deduplication pointer, but the associated business facts must not be copied into REV without a separately confirmed permitted use.

### C. Outscraper

- **Coverage/search:** Google Maps Scraper advertises global business listings, categories, locations, websites, contacts/enrichments, filters, and export/API access. UK coverage is plausible from global location support, but UK-specific completeness was not independently established from the accessible official page.
- **Cost:** Official page advertises the first 500 businesses free, then `$3/1,000` records from 501 to 100,000, and `$1/1,000` after 100,000. Approximate usage: 10 `$0`, 100 `$0`, 1,000 about `$1.50` if pricing is prorated per record after the first 500. Pricing is subject to change.
- **Upfront/payment:** No prepaid minimum is advertised on the pricing page; however, the Terms state a payment method is required before first use. That means no guaranteed zero-payment-method path.
- **Auth/server suitability:** API access is advertised; credentials would be server-side. The public API documentation requires account access and was not available for complete extraction.
- **Rate limits:** No authoritative public rate limit was verified from accessible official documentation; must be obtained before approval.
- **Persistence/licensing:** Outscraper describes its service as scraping Google Maps and says public data is available, but its accessible Terms do not provide a clear, specific license for REV to permanently store Google-derived names, addresses, websites, and identifiers in a multi-tenant CRM. The Terms also require compliance with law and disclaim accuracy. Written clarification is required.
- **Main risk:** Cheapest discovery test, but the scraping architecture and unclear persistent-storage rights create legal/operational uncertainty.

### D. Serper

- **Coverage/search:** Serper advertises Google Search and a Maps/Places capability in its product interface. It is primarily a Google web-search API rather than a clearly documented structured business-listings API in the accessible public docs. UK query-location customization is advertised.
- **Cost:** Official site advertises 2,500 free queries with no credit card. Paid Starter is `$50` for 50,000 credits, or `$1/1,000` queries; credits are valid six months. Approximate usage: 10/100/1,000 queries `$0` within the free allowance.
- **Upfront/payment:** No card for the advertised free 2,500-query allowance; paid use starts at `$50`.
- **Auth/server suitability:** API key/server-side use is suitable; never expose it to the browser.
- **Rate limits:** Official landing page advertises 50 queries/sec for Starter, 100 for Standard, 200 for Scale, and 300 for Ultimate. Account-specific limits still require confirmation.
- **Persistence/licensing:** Serper's Terms say it supplies web-scraped data, prohibit misrepresenting source/ownership and removing notices, and do not clearly grant durable CRM-style storage of third-party Google-derived business records. The product is not a strong evidence source for structured business identity, and terms should be treated as unresolved for persistence.
- **Main risk:** Cheap query testing but weaker structured business output and high provenance/licensing ambiguity.

### E. Companies House API

- **Coverage/search:** Search and retrieve UK companies covered by the Companies Act 2006. Returns company number, name, status, registered office, SIC/activity classifications, filing data, and other company-register records. It does not cover every trading business, sole trader, unincorporated partnership, or local establishment.
- **UK:** Native UK coverage and authoritative company identifiers.
- **Cost:** Public API access is free; no paid subscription or minimum deposit was identified in the official developer documentation.
- **Upfront/payment:** Requires a registered user/application and API key, but no payment card or deposit was identified.
- **Auth/server suitability:** HTTP Basic Auth with API key as username, or OAuth for user-authorized flows. Server-side use is appropriate; keys must not be embedded in source.
- **Rate limits:** 600 requests within five minutes; excess requests receive HTTP 429 for the remainder of the window. Applications that regularly exceed or bypass limits may be banned.
- **Persistence/licensing:** Government register data is publicly available and Crown copyright/reuse rules apply. Company number and verified register facts are the strongest persistence candidate in this comparison, subject to complying with the applicable Open Government Licence/reuse notices and Companies House terms. This source does not solve local-business discovery by itself.
- **Main risk:** Excellent verification and deduplication anchor for incorporated prospects, incomplete discovery coverage.

### F. Foursquare Places API

- **Coverage/search:** Global POI database, category search, locality/radius/rectangle search, business name/category queries, website and place identifiers depending on fields. Official product page claims 100M+ POIs across 200+ countries.
- **UK:** Global location model supports UK locality searches; exact UK SME completeness requires an empirical test.
- **Cost:** Official pricing lists Pro endpoints at `$0` for 0-500 calls, then `$15/1,000` calls for 501-100,000, with lower volume rates at higher tiers. Approximate: 10/100 `$0`; 1,000 about `$7.50` if prorated after 500. The product page separately advertises up to 10,000 free sandbox calls, which must not be assumed to apply to production.
- **Upfront/payment:** Free account/sandbox is advertised; production billing terms/card requirements were not fully established from the accessible official pages.
- **Auth/server suitability:** Bearer service key, server-side suitable.
- **Rate limits:** Official endpoint documentation links a rate-limit reference, but the exact current limit was not extracted here; must be confirmed before approval.
- **Persistence/licensing:** Foursquare advertises flexible licensing but the accessible public pages did not establish that all returned POI fields and identifiers may be permanently persisted in REV's multi-tenant commercial memory. Requires review of the Places API Self-Service EULA and, if needed, written confirmation.
- **Main risk:** Strong credible alternative with less Google-specific policy pressure than direct Places, but persistence terms remain unverified.

## Weighted scoring

Scores use the requested weights: UK coverage 20, persistence/licensing fit 20, discovery quality 15, cost 15, upfront payment 10, scalability 10, API/developer quality 5, lock-in 5. Unknown licensing/rate-limit facts are scored conservatively rather than assumed safe.

| Provider | UK coverage | Persistence / licensing | Quality | Cost | Upfront | Scale | API | Lock-in | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Companies House | 10 | 19 | 10 | 15 | 10 | 7 | 4 | 5 | **80** |
| Outscraper | 18 | 9 | 14 | 15 | 4 | 8 | 4 | 3 | **75** |
| DataForSEO | 19 | 12 | 14 | 11 | 2 | 9 | 5 | 3 | **75** |
| Foursquare | 17 | 11 | 12 | 13 | 7 | 8 | 4 | 3 | **75** |
| Google Places | 20 | 4 | 15 | 12 | 5 | 9 | 5 | 2 | **72** |
| Serper | 12 | 6 | 9 | 14 | 8 | 9 | 4 | 2 | **64** |

These totals must be read with role: Companies House ranks first as a persistent verification source, not as the first local-business discovery source. Outscraper, DataForSEO, and Foursquare are tied on provisional discovery score; each has a different unresolved risk.

## Cost examples

| Provider | 10 businesses | 100 businesses | 1,000 businesses | Important qualification |
| --- | ---: | ---: | ---: | --- |
| DataForSEO | ~$0.016 | ~$0.048 | ~$0.372 | Published task + item pricing; account minimum payment published as $50 |
| Google Places | $0 in free-cap scenario | $0 in free-cap scenario | $0 in free-cap scenario | Depends on field mask/SKU and monthly free cap; billing required; not a persistence-safe source |
| Outscraper | $0 | $0 | ~$1.50 | First 500 records advertised free; card required before first use under Terms |
| Serper | $0 | $0 | $0 | Within 2,500 free queries; structured Places suitability not established |
| Companies House | $0 | $0 | $0 | Company-register searches only; 600 requests/5 minutes |
| Foursquare | $0 | $0 | ~$7.50 | Based on published 0-500 free then $15/1,000; production billing terms require confirmation |

## Recommended architecture

`Discovery provider -> normalized candidate -> evidence/quality gate -> optional Companies House verification -> deduplication -> owner qualification -> Contact/Opportunity`

1. Use a provider-independent adapter boundary exactly as Phase 3F.1 established.
2. Use a POI discovery source only to produce candidates. Do not treat discovery as qualification or permission to contact.
3. Use Companies House as an optional verification/enrichment source when the candidate appears to be an incorporated UK company. Persist company number and verified register facts under applicable government reuse rules.
4. Keep Google Place IDs or other provider IDs only where the provider explicitly permits durable storage. Do not copy restricted Google/Maps content into REV memory by default.
5. Persist only normalized, provider-permitted business facts, provenance, observed time, retention class, and deterministic REV inference. Never persist raw provider payloads or personal contact enrichment in this phase.
6. Enforce per-workspace and global limits, request idempotency, rate limiting, and a hard development ceiling before any provider call. A free plan must not imply unlimited calls.

## Cost Governor requirements

Before execution, the trusted server must check:

- workspace plan and remaining allowance;
- provider-specific allowance and account balance where available;
- global provider allowance across all workspaces;
- development ceiling `REV_PROVIDER_TEST_BUDGET_GBP <= 10`;
- request idempotency/correlation key and in-flight duplicate suppression;
- application rate limit and concurrency limit;
- country `GB` and a bounded candidate limit.

After execution, record provider, operation, units, estimated/actual cost, success/failure, timestamp, correlation ID, and provider task identifier only where retention is permitted. Retries must never happen automatically after an ambiguous billable response without reconciliation.

## Decision

**RECOMMEND DATAFORSEO $50 PAYMENT:** **NO**.

**1ST PLACE:** Companies House for persistent UK verification, not discovery.  
**2ND PLACE:** Outscraper for the cheapest narrowly controlled discovery experiment, subject to written persistence/legal confirmation.  
**3RD PLACE:** DataForSEO or Foursquare for a later structured discovery comparison; DataForSEO has the stronger documented API shape, Foursquare the better upfront-cost profile.

**CHEAPEST SAFE TEST OPTION:** Companies House for verification-only testing. For actual local-business discovery, Outscraper is the lowest advertised-cost option, but it is not yet the safest persistence option.  
**BEST LONG-TERM OPTION:** Hybrid POI discovery plus Companies House verification, with the POI provider selected only after its retention/licensing terms are confirmed.  
**BEST PERSISTENCE RIGHTS:** Companies House, within Crown copyright/Open Government Licence and API terms.  
**BEST UK COVERAGE:** Google Places/DataForSEO/Outscraper likely for local POIs; no independent completeness claim is made. Companies House is best for incorporated companies.  
**BEST HYBRID ARCHITECTURE:** Low-cost POI candidate discovery -> Companies House company-number verification where matched -> REV normalization and quality gate -> explicit owner qualification -> Contact/Opportunity.

## Stop gate

No provider was integrated or connected. No credentials were entered. No API call, funding, database migration, Edge Function deployment, scraping, enrichment, AI call, or outreach occurred. Before any next step, obtain written persistence/licensing confirmation for the selected POI source and approve the trusted execution boundary and cost controls.
