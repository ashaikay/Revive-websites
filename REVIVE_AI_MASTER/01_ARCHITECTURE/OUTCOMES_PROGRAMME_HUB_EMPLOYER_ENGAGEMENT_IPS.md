# Outcomes / Programme Hub — Employer Engagement / IPS Foundation

**Status:** Canonical architecture plus the tenant-neutral foundation integrated into the existing authenticated REV app. The foundation includes programme configuration, employer/contact records, vacancies, minimal participant employment profiles, explicit programme advisers and participant caseload assignments. The user verified that creating “Best programme” persists after refresh. The foundation migration and save function are recorded as deployed; participant notes and the first employer-discovery/engagement slice remain local and undeployed. The local engagement slice adds Companies House registry discovery, reviewed employer saving, engagement stages/history and separately gated AI draft preparation that remains **Prepared — not sent**. No live provider call, outreach send, deployment or gate enablement has occurred. Matching, employment outcomes, reporting, imports and voice updates remain extension points.

**Provenance:** This is the pre-existing 21 September 2026 employment-support plan, clarified on 8 October 2026. It is not a new module.

## 1. Product placement and boundaries

Employer Engagement belongs inside **Outcomes / Programme Hub** for employment-support and Individual Placement and Support (IPS) organisations.

It is not:

- commercial GROWTH lead generation, revenue pipeline or REV attribution;
- the worker Scheduling domain used for employees, shifts, availability, sickness or Annual Leave;
- an email execution capability;
- a clinical record or health case-management system.

### 1.1 Agreed business terminology and simplicity principles

Business-facing Programme Hub wording uses:

- **Service users** for people receiving employment support;
- **Employment Specialists** for authorised programme advisers;
- **Job opportunities** for employer vacancies or opportunities.

Existing canonical schema and trusted-boundary names such as `participant`, `adviser` and `vacancy` remain unchanged for compatibility. The wording change does not create new roles or broaden access.

The selected programme must remain visible. Overview/setup, Employment Specialists and caseload, Service users, employers/contacts, Job opportunities, discovery, engagement history and prepared outreach remain simple sections within that selected programme rather than separate applications or a competing CRM. Empty, loading, error, unconfirmed-save and exact-retry states must be explicit. Workspace or programme switching clears prior results and prevents late responses from repopulating the new context.

Initial engagement stages are platform workflow states, not tenant outcome vocabulary: **To review**, **Ready to contact**, **Contacted**, **Conversation underway**, **Opportunity identified** and **Not pursuing**. Manually recorded contact is labelled separately from messages sent by REV. This slice has no sending state.

The first implementation should support a supervised employment workflow:

1. Record an employer and employer contact.
2. Record an employer opportunity or vacancy.
3. Record a minimal participant employment profile.
4. Assign one or more authorised advisers to the participant.
5. Calculate an explainable match using the current contract and evidence.
6. Let an assigned adviser review the match.
7. Prepare and review a version-bound employer-engagement draft.
8. Preserve the durable state **Approved — not sent**.
9. Record explicit employment outcomes.
10. Produce reporting that traces every count to durable source records.

No approval, match, meeting, draft or inferred activity may be presented as an employment outcome.

## 2. Shared contract conventions

Every durable record defined here has:

- `id`: UUID.
- `workspace_id`: tenant boundary.
- `programme_id`: Outcomes / Programme Hub programme boundary where applicable.
- `version`: positive optimistic-concurrency version.
- `created_at`, `created_by`, `updated_at`, `updated_by`.
- a composite tenant identity such as `unique (workspace_id, id)`.
- no browser-side direct write path.

Trusted writes use:

- active membership and operation-specific authority checks;
- service-only database mutation;
- restrictive row-level security;
- exact request IDs and immutable request payload fingerprints;
- optimistic version checks for corrections;
- append-only audit evidence;
- explicit conflict and validation errors;
- no hard deletion of audited programme records.

Canonical keys use stable lowercase `snake_case`. Tenant labels may be mapped to these keys but do not change their meaning.

## 3. Programme, branding and sender identity

### `outcomes_programmes`

Represents one configured employment-support programme.

Required canonical fields:

- `id`, `workspace_id`.
- `programme_key`: tenant-stable external or internal key.
- `name`.
- `status`: platform lifecycle only (`active`, `paused`, `archived`).
- `default_timezone`.
- `branding_profile_id`.
- `sender_identity_id`.

The programme record does not contain eligibility rules, outcome vocabulary or spreadsheet column names. Those are separately versioned contracts.

### `programme_branding_profiles`

Versioned, effective-dated presentation identity:

- `programme_id`.
- `version`.
- `display_name`.
- optional `logo_asset_reference`.
- optional contact/footer text.
- `effective_from`, optional `effective_to`.
- `status`: `draft`, `active`, `retired`.

Branding is presentation context. It is not sender authority.

### `programme_sender_identities`

Versioned, effective-dated identity shown on a draft:

- `programme_id`.
- `version`.
- `display_name`.
- `reply_address`.
- optional `organisation_unit`.
- optional future provider binding reference.
- `effective_from`, optional `effective_to`.
- `status`: `draft`, `active`, `retired`.

No provider credential, token or secret is stored in this record. Selecting a sender identity does not enable sending. A draft snapshots the sender-identity version used during review.

## 4. Adviser authority and caseload access

Caseload access is mandatory in the first release.

### `programme_advisers`

Explicitly grants programme authority to an existing active workspace member:

- `workspace_id`, `programme_id`, `user_id`.
- `status`: `active`, `inactive`.
- `effective_from`, optional `effective_to`.
- optional tenant-defined adviser reference.

Workspace membership alone does not make a user an employment adviser.

### `participant_adviser_assignments`

Effective-dated caseload assignment:

- `workspace_id`, `programme_id`, `participant_id`, `adviser_user_id`.
- tenant-configured assignment-role key.
- `effective_from`, optional `effective_to`.
- `status`: `active`, `ended`.
- assignment version and audit evidence.

Access rules:

- active owner/admin may administer programme configuration and caseload assignment;
- an active programme adviser may read programme-level employer and vacancy records;
- participant profiles, participant evidence, participant matches, participant-linked drafts and outcomes are readable only by active owner/admin or an adviser with a current caseload assignment;
- only an authorised assigned adviser or owner/admin may review a participant match or participant-linked draft;
- inactive, suspended, expired, unrelated-caseload and cross-workspace access fails closed;
- reporting uses the same row-level caseload restrictions rather than filtering only in the browser.

Whether owners/admins should see every participant is an implementation decision to confirm before coding. The recommended first-release default is yes for programme administration and safeguarding, with every access auditable.

### Agreed organisation-access clarification — not implemented

Employment Specialists are individual authenticated workspace users who must be explicitly authorised for identified programmes. Participant-level access additionally requires a current active caseload allocation. Authorised managers require a defined programme-oversight scope; manager status must not be inferred solely from general workspace membership.

Owners are responsible for organisation invitations, permission administration and access revocation. Suspended or revoked users must lose programme, caseload, note, private-file and reporting access. Trusted functions, RLS and private-storage policies must enforce programme, caseload and workspace boundaries server-side, and important actions must retain the authenticated actor.

This requirement does not rename or replace the existing owner/admin and `programme_advisers` contracts. Any new Employment Specialist or programme-manager membership role requires an explicit migration and implementation plan covering role mapping, oversight scope, revocation, audit evidence, RLS/storage authorization, backward compatibility and cross-workspace/cross-caseload tests.

## 5. Employers and employer contacts

### `programme_employers`

An employer organisation engaged by the programme, not a commercial customer or revenue opportunity:

- `workspace_id`, `programme_id`.
- `employer_key`: stable tenant/import key.
- `display_name`.
- optional registered/trading name.
- optional sector key from tenant configuration.
- `status`: `active`, `archived`.
- structured primary work-location reference.
- source provenance fields.

Archiving removes an employer from active selection but retains contacts, vacancies, engagement history and audit evidence.

### `programme_employer_contacts`

A person acting for an employer:

- `workspace_id`, `programme_id`, `employer_id`.
- `contact_key`: stable tenant/import key.
- `display_name`.
- optional role/title.
- optional business email and business phone.
- preferred-contact-channel key from tenant configuration.
- contactability status.
- suppression status and recorded reason key.
- source provenance fields.

Suppression is checked before a draft can become reviewable. Removing suppression, when policy permits it, is separately authorised and audited.

## 5.1 Employer discovery and first engagement workspace

Employer discovery is programme-scoped and remains separate from advertised Job opportunities. Manual employer entry remains available even when discovery providers are disabled.

The first provider adapter uses the official Companies House Public Data API advanced company search. It accepts editable geography and sector filters, with pilot defaults for Birmingham / West Midlands and construction, retail, warehousing/logistics, traffic management, rail/train-related work, Royal Mail/postal delivery and Post Office branch roles. Royal Mail/postal delivery and Post Office branch roles are separate user filters. Barbering is an editable default exclusion, not an eligibility rule.

Companies House evidence establishes only public registry facts such as company identity, status, registered office and SIC codes. A registered office is not evidence of a workplace, branch, recruiting site, vacancy, employer relationship or contact detail in the selected area. Results therefore show verified facts and explicit unknowns. External content is untrusted evidence and never an instruction to REV or an AI provider.

Provider controls:

- official documentation: `https://developer.company-information.service.gov.uk/` and the Public Data API specification;
- access: a Companies House account, registered application and server-side API key;
- server settings: `COMPANIES_HOUSE_API_KEY` plus disabled-by-default `REV_PROGRAMME_EMPLOYER_DISCOVERY_ENABLED=true`;
- cost: Companies House Public Data API access is free;
- default provider limit: 600 requests per five minutes;
- licence: Companies House public data is reused under the Open Government Licence v3.0 and the UI includes the required attribution;
- display/storage: REV stores the reviewed source identity, official source URL, retrieval time, registered address and evidence used for the decision. It stores no guessed contacts and does not imply Companies House endorsement.

Each search is durably claimed before the provider call. An exact replay returns the durable outcome and never makes another provider call. A changed retry is rejected. If the provider may have been called but completion is uncertain, REV preserves the uncertain state and does not retry the provider under the same request.

Saving a discovery result uses the durable Companies House company number as the reliable source identity. An existing identical source identity is reported without merge or overwrite. Name/address similarities are only possible duplicates for Employment Specialist review.

The employer detail workspace stores one programme-scoped stage, responsible Employment Specialist, next action and follow-up date plus append-only timestamped history. History explicitly distinguishes manual records from REV-prepared artifacts. There is no automatic follow-up, assignment, application, deletion or outreach execution.

## 5.2 Prepared employer outreach

Outreach preparation uses saved employer evidence, the programme offer, branding and sender identity. It contains no Service user personal information. A suppressed selected contact is refused server-side.

The real server-side adapter uses OpenAI Responses with pinned `gpt-4.1-mini-2025-04-14`, strict structured output, no tools and `store: false`. The separate capability requires `OPENAI_API_KEY` and disabled-by-default `REV_PROGRAMME_EMPLOYER_OUTREACH_AI_ENABLED=true`. `REV_PROGRAMME_EMPLOYER_OUTREACH_DAILY_LIMIT` defaults to 10 attempts per workspace per UTC day and accepts 1–50. Browser code receives no provider key.

OpenAI's published standard GPT-4.1 mini rates at this checkpoint are US$0.40 per million input tokens, US$0.10 per million cached input tokens and US$1.60 per million output tokens. A typical bounded draft around 1,000–2,000 input tokens and 300–600 output tokens is approximately US$0.0009–US$0.0018, before taxes or future price changes.

`store: false` prevents Responses application-state storage but does not itself guarantee zero retention. OpenAI documents default abuse-monitoring logs of up to 30 days; approved Zero Data Retention or Modified Abuse Monitoring requires a separate OpenAI arrangement. No employer draft provider should be enabled until the organisation accepts the provider's current data controls.

Draft attempts are claimed before the provider call, limited to one provider attempt, audited with model and token usage, and completed only if the employer, contact suppression state and programme offer versions still match. Late stale output is retained as a failed attempt and cannot replace current evidence. The resulting immutable revisions remain **Prepared — not sent**. Editing creates a new revision; this slice has no approval-to-send, scheduler or delivery endpoint.

## 5.3 Agreed programme lists, exports and simpler sections — pending

The next separately scoped Programme Hub pass must add programme-scoped list views for employers and employer contacts and for Service users. This is an agreed requirement, not an implemented capability.

Each list must use plain business labels, understandable columns, text search and bounded filters over records the current user is authorised to read in the selected programme. The selected programme remains visible. Programme/workspace switching clears prior list and export state, and late responses from the previous context must not repopulate the new selection.

Employer/contact lists use the existing employer identity, sector/geography, active state and existing business-contact fields where useful. They must not fabricate contacts or convert registry evidence into a contact. Service-user lists use only necessary employment-support identity and contact fields and remain subject to the existing owner/admin or active allocated-caseload permissions.

The current deployed foundation stores Service user preferred name, case reference, employment preferences/skills and geography/evidence references, but it does not store Service user email, phone, postal address or postcode. Supporting those details therefore requires an explicit additive migration plus the existing trusted participant-write boundary, validation, versioning, tenant constraints, restrictive RLS, exact retry and audit conventions. The minimum proposed contact set is optional email, optional phone, optional address lines/locality and optional postcode. It must not become unrestricted case-note storage. A postcode is contact/location data only and never establishes programme residency, service-area or other eligibility.

Programme list exports are `.xlsx` downloads generated from the authorised, currently filtered result set. The implementation should reuse the existing Scheduling reporting approach where suitable: bounded in-memory generation, plain inline cell values, spreadsheet-formula neutralisation, deterministic filenames and no formula or external-link execution. Exports must fail rather than claim completeness after a paginated read or permission failure. Programme notes, residency evidence, sensitive evidence, suppression reasons and other non-selected personal data are excluded by default. Personal data is never exported automatically; the user explicitly requests each download.

Programme Hub remains one page and does not gain competing navigation. Existing programme areas become clearly labelled collapsible sections using established REV styling. Collapsed summaries may show only factual counts or state derived from the authorised loaded records; they must not invent performance metrics. Active forms, validation errors and uncertain-save retry controls remain visible, and collapsing a section must preserve entered values and retained retry payloads.

Acceptance checks for the separate implementation pass include:

- Service-user contact/address/postcode persistence and correction through trusted writes;
- owner/admin and allocated-caseload reads, with inactive, unrelated-caseload and cross-workspace/programme denial;
- programme switching that clears stale list, filter and export state;
- search/filter behavior and factual collapsed summaries;
- `.xlsx` contents matching the selected programme, current filters and authorised rows;
- default exclusion of notes and sensitive evidence plus spreadsheet-formula neutralisation;
- preservation of active form input, validation errors and uncertain-save retry controls while sections collapse.

## 6. Vacancies and employer opportunities

### `programme_vacancies`

An employment opportunity offered or potentially offered by an employer:

- `workspace_id`, `programme_id`, `employer_id`.
- optional primary `employer_contact_id`.
- `vacancy_key`: stable tenant/import key.
- `title`.
- structured description.
- tenant-configured vacancy-status key.
- optional opening and closing dates.
- structured work pattern and hours.
- required and desirable skill keys.
- vacancy search geography reference.
- structured work-location reference.
- source provenance fields.

The platform must not invent the tenant's vacancy status vocabulary. A separately versioned vocabulary maps tenant values to the minimal platform behavior needed to determine whether a vacancy can participate in matching.

A vacancy is not a Scheduling job and creates no worker assignment, rota entry, availability conflict or Annual Leave effect.

## 7. Minimal participant employment profile

### `programme_participants`

Only employment-support data needed for matching and reporting:

- `workspace_id`, `programme_id`.
- `participant_key`: stable tenant/import key.
- `display_name`.
- `status`: platform lifecycle only (`active`, `paused`, `exited`, `archived`).
- tenant-configured employment-stage key.
- desired role/occupation keys.
- skill and qualification keys.
- work-pattern and hours preferences.
- accessibility or adjustment requirement keys only where lawfully required and explicitly configured.
- vacancy-search geography profile reference.
- current residency-evidence status reference.
- source provenance fields.

The foundation must not capture diagnoses, symptoms, treatment, medication, clinical notes, benefit details, unrestricted case notes or free-text health histories.

If a tenant later proves that a sensitive field is necessary, it requires a separate data-protection, access and retention review. It is not added as generic metadata.

### `programme_participant_notes`

Append-only notes belong to one participant's record in one programme. They do not create a shared cross-programme case-note history.

Each note stores:

- `workspace_id`, `programme_id`, `participant_id`;
- a trimmed employment-support fact, action or progress note;
- the server-bound author;
- a server-generated creation timestamp.

Only an active owner/admin or an active programme adviser with a current caseload assignment may create or read a participant note. Exact request replay returns the original note and never creates a duplicate. Notes have no browser-direct write path, correction, deletion or silent overwrite behavior. The user interface reminds advisers not to record diagnoses or unnecessary sensitive details and displays the immutable creation time in the programme timezone.

### 7.1 Planned vocational profile and action plan — not implemented

The future Service-user profile remains employment-focused and programme-scoped. It is not part of the current notes, button or save-feedback tidy-up and must not be simulated in browser storage.

The reviewed vocational profile may include only information needed to provide employment support:

- employment goals and preferred occupations;
- strengths, existing skills, qualifications and relevant work experience;
- work-pattern, hours, location, travel and remote/hybrid preferences;
- agreed training interests and evidence-backed development needs;
- necessary workplace adjustments or support requirements expressed functionally rather than as diagnoses;
- source, author, review date and current version for each reviewed section.

Unknown information remains unknown. REV must not infer qualifications, work readiness, health, risk, eligibility or suitability from missing fields, postcode, notes or external data.

The future action plan is a separate versioned working record linked to the Service user and programme. It records agreed employment goals and discrete actions with an owner, target/review date, status and completion evidence where applicable. Corrections preserve history and audit evidence. REV does not silently complete actions, alter outcomes, submit applications, enrol someone on training or assign an employer opportunity.

Safeguarding and probation-related requirements need a separate approved data-protection and authorization design before implementation:

- collect only a necessary employment-support restriction, required appointment, approved contact route or agreed safeguarding action;
- do not collect offence narratives, allegations, diagnoses, clinical histories or unrestricted probation/case records;
- record the lawful purpose, source, author, review/expiry date and who may access the information;
- restrict access beyond ordinary programme/caseload visibility where policy requires it, enforced server-side rather than by UI hiding;
- keep urgent safeguarding procedures outside REV Brain suggestions and make clear that REV is not an emergency-reporting service;
- never use safeguarding/probation information to automatically exclude a person, rank them, disclose it to an employer or generate outreach;
- define correction, retention, expiry, disclosure and audited-access rules before adding schema or trusted writes.

Any sensitive extension requires an additive migration, restrictive RLS, trusted versioned writes, exact retries, audit evidence and tests for inactive, unrelated-caseload, cross-programme and cross-workspace denial. Tenant policy, lawful basis and retention decisions must be approved before coding.

### 7.2 Planned REV Brain suggestions — not implemented

After the vocational profile and action plan are implemented and verified, a separately authorised REV Brain slice may connect to approved job and training sources. Sources, credentials, usage limits, licence/storage restrictions and evidence retention must be reviewed before enablement.

Suggestions must cite the approved source evidence and explain the relevant profile evidence, unknowns, gaps and conflicts. An authorised Employment Specialist reviews every suggestion. REV Brain must not invent vacancies, courses, qualifications or eligibility; make automatic applications, referrals or enrolments; alter the action plan; or expose safeguarding/probation information to providers or employers.

### 7.3 Agreed implementation order

1. Finish and verify the existing Programme Hub forms, participant notes, button states, definitive-versus-uncertain save feedback, retained retries and section behavior.
2. Build and verify the employment-focused vocational profile and versioned action plan, including the separately approved safeguarding/probation controls above.
3. Connect REV Brain to approved job and training sources for evidence-backed, explained suggestions that require Employment Specialist review.

Later steps do not begin automatically. Provider selection or enablement, schema deployment and hosted migration each require separate authorization.

## 8. Three separate geography contracts

The following concepts must never be collapsed into one postcode or one generic `geographic_match` score.

### 8.1 Participant residency eligibility

Answers: **Does the available evidence establish that the participant meets the programme's residency rule at the relevant date?**

Inputs:

- versioned residency-rule set;
- rule effective date;
- permitted evidence-type keys;
- participant evidence references and evidence dates;
- explicit approved exceptions.

Result:

- `eligible`;
- `ineligible`;
- `needs_review`.

Matching postcode areas do not prove residency. Missing, expired, conflicting or unsupported evidence yields `needs_review`.

### 8.2 Vacancy-search geography

Answers: **Where is this participant willing and able to search for work?**

This is a participant preference/constraint, not programme eligibility. It may use configured areas, travel-time bands, remote/hybrid rules or other tenant-defined geography types. The platform must not invent a distance rule.

### 8.3 Service-delivery geography

Answers: **Where is this programme contracted or authorised to deliver support?**

This is defined by the programme's current effective rule set. It is not inferred from the participant's preferences or the vacancy location.

### 8.4 Vacancy location

The vacancy stores its work location independently. A future approved reference-data provider may normalize locations, but the first contract accepts only tenant-configured structured geography identifiers.

## 9. Versioned contract rules and exceptions

### `programme_rule_sets`

- `workspace_id`, `programme_id`.
- `rule_set_type`: `residency_eligibility`, `vacancy_search_geography`, `service_delivery_geography`, or another separately approved type.
- `version`.
- `effective_from`, optional `effective_to`.
- `status`: `draft`, `active`, `retired`.
- deterministic rule definition.
- required evidence-type keys.

Only one active rule-set version may apply for a programme, rule-set type and effective instant.

### `programme_rule_exceptions`

- rule-set identity and version.
- participant, vacancy or programme scope as explicitly configured.
- `effective_from`, optional `effective_to`.
- tenant-configured exception-type key.
- authorising user and authorisation timestamp.
- structured evidence reference.
- version and audit evidence.

Exceptions never silently rewrite a rule result. The eligibility or match decision records both the original result and the authorised exception applied.

### `programme_eligibility_decisions`

Immutable decision versions contain:

- participant and programme.
- evaluated effective date.
- exact rule-set IDs and versions.
- exact evidence versions.
- original result.
- applied exception version, if any.
- final result.
- deterministic reason codes.
- decision fingerprint.
- decided/reviewed actor and timestamp.

Corrections append a new version. Previous decisions remain reportable.

## 10. Deterministic participant-to-vacancy matching

### `participant_vacancy_matches`

Each match version binds:

- participant profile version;
- vacancy version;
- current caseload assignment;
- current programme rule-set versions;
- current eligibility-decision version;
- current vacancy-search geography profile;
- evidence versions used.

Minimum result:

- `match`;
- `no_match`;
- `needs_review`.

The platform calculates independent checks for:

- participant programme eligibility;
- vacancy active/searchable behavior under the tenant's vocabulary mapping;
- required skills or qualification evidence;
- desired role/occupation alignment;
- work-pattern/hours compatibility;
- vacancy-search geography against vacancy location;
- service-delivery geography;
- missing or conflicting evidence.

Every check returns a stable reason code and a user-facing explanation. The overall result is deterministic:

- any definitive blocking check produces `no_match`;
- any required unknown, missing, expired or conflicting evidence produces `needs_review`;
- `match` is allowed only when every mandatory check passes.

An adviser may review a result but may not overwrite the calculated evidence. An adviser decision is stored separately as `accepted`, `rejected` or `needs_more_information`, using platform review states rather than an invented tenant outcome vocabulary.

## 11. Draft preparation and adviser approval

### `employer_engagement_drafts`

A draft is linked to:

- programme;
- employer and employer contact;
- vacancy;
- optional participant and reviewed match;
- template mapping profile and version;
- branding profile version;
- sender-identity version.

The current draft stores:

- channel key;
- subject/title where the configured channel supports one;
- body/content;
- version;
- SHA-256 fingerprint;
- status.

The draft must expose unsupported or missing template values as review issues. It must not fabricate participant, employer, vacancy or programme facts.

### `employer_engagement_draft_reviews`

Review binds to the exact:

- draft ID;
- draft version;
- draft fingerprint;
- template mapping version;
- branding version;
- sender-identity version;
- reviewer authority/caseload assignment.

Correcting any bound input invalidates the prior review.

Platform review decisions are:

- `approved_not_sent`;
- `changes_requested`;
- `rejected`.

The user-facing approved state is always **Approved — not sent**. There is no send, queue, schedule, provider claim or delivery state in this foundation.

Suppressed contacts, stale matches, expired adviser assignments, changed residency eligibility, missing sender identity or changed template versions fail closed and require a fresh review.

## 12. Explicit employment outcomes

### Tenant-configured outcome vocabulary

The organisation's outcome types and reporting categories must be supplied before implementation. REV must not invent them.

A versioned `programme_outcome_definitions` contract provides:

- tenant outcome key and label;
- effective dates;
- active/retired status;
- entity scope;
- required evidence-type keys;
- reporting category mapping supplied by the tenant;
- correction and terminal-state behavior.

### `programme_outcome_events`

Every outcome event records:

- programme and workspace;
- participant where applicable;
- employer, contact, vacancy and match links where applicable;
- configured outcome-definition key and version;
- effective/occurred date;
- structured evidence references;
- source type;
- recorded actor;
- version/correction relationship;
- audit evidence.

Approval, draft creation, meeting booking, email provider acceptance, match acceptance or an adviser voice proposal never creates an outcome automatically.

Corrections append a replacement version and retain the superseded event. Deletion is not the correction mechanism.

## 13. Traceable reporting

Reporting reads only durable records visible to the requesting user.

Every report result must expose:

- programme;
- reporting period and timezone;
- exact outcome-definition versions included;
- exact rule-set versions relevant to eligibility measures;
- source record count;
- drill-down identifiers;
- generated timestamp.

The platform provides reporting infrastructure but does not invent tenant KPIs, statutory measures or success definitions. Configured reports map tenant outcome keys into tenant-supplied reporting categories.

Missing, late, corrected and `needs_review` records remain distinguishable. They are not silently omitted or counted as success.

## 14. Configurable Excel and template mapping

The foundation defines canonical fields, not organisation spreadsheet columns.

### `programme_import_mapping_profiles`

- programme and entity type.
- mapping key and version.
- effective dates and status.
- source format and sheet identifier where configured.
- tenant-supplied source-column to canonical-field mappings.
- transformation and validation rules from an approved bounded vocabulary.
- stable source-record key mapping.
- duplicate/conflict policy.

Before any import writes data, it must provide:

1. mapping preview;
2. row-level validation;
3. missing-required-field results;
4. duplicate and conflict preview;
5. geography and evidence warnings;
6. explicit authorised confirmation;
7. an immutable import-batch record.

Unknown columns are not guessed. Unmapped required fields block the row. Imports preserve source provenance, mapping version and source record key.

Template mappings use the same versioned approach. Placeholder names are canonical contract keys, while organisation-specific template names and wording remain tenant configuration.

## 15. Future adviser-confirmed voice updates

Voice is a future input adapter, not a direct write path.

A future voice flow may:

1. capture or receive authorised adviser audio;
2. produce a transcript;
3. map it to a proposed structured command;
4. display every proposed field, evidence reference and outcome key;
5. require the authorised adviser to confirm or correct it;
6. submit through the same trusted, versioned command used by manual entry.

No unconfirmed transcript changes a participant, match, draft or outcome. Raw audio/transcript retention, consent and deletion require a separate decision. The recommended default is not to retain raw audio and to discard the transcript after confirmed structured capture, subject to the organisation's approved policy.

## 16. Tenant isolation and audit requirements

Required validation includes:

- owner/admin configuration authority;
- explicit active adviser authority;
- current caseload assignment;
- inactive, expired and suspended denial;
- cross-workspace denial;
- cross-caseload denial;
- direct table-write denial;
- exact request replay;
- stale-version conflict;
- rule effective-date boundaries;
- overlapping rule-version prevention;
- exception start/end boundaries;
- missing/expired/conflicting evidence producing `needs_review`;
- postcode-area overlap not proving residency eligibility;
- draft correction invalidating approval;
- suppressed employer-contact refusal;
- participant-linked reporting respecting caseload access;
- correction history and audit counts.

## 17. Implementation sequence

1. Confirm the tenant decisions in section 18.
2. Approve this canonical contract.
3. Add additive schema, restrictive RLS and trusted boundaries. **Implemented locally for the first foundation records.**
4. Add canonical mapping validation with tenant-supplied fixtures.
5. Add the Outcomes / Programme Hub UI for employer, vacancy, participant and caseload records. **Implemented locally. Match review remains pending tenant rule configuration.**
6. Add programme-scoped employer discovery, engagement history and versioned **Prepared — not sent** outreach review. **Implemented locally with disabled provider capabilities; not deployed or provider-verified.**
7. Add explicit outcome entry/correction and traceable reporting.
8. Run focused, mounted, boundary and isolated database validation.

Provider delivery, live outreach, generic spreadsheet ingestion, voice capture and deployment require separate authorization.

Job fairs/events, Service user-to-Job opportunity matching and applications are the documented next slices after this employer-discovery/engagement foundation. They remain separate and are not implemented by this pass.

The agreed programme-list, Service-user contact/address, filtered `.xlsx` export and collapsible-section work in section 5.3 is also pending as its own scoped pass. It does not authorize job fairs/events, matching, applications, provider enablement or outreach sending.

The local foundation deliberately leaves `programme_hub_contracts` empty until the tenant supplies its rule versions, outcome vocabulary and mappings. The UI displays **Needs review** and does not expose matching or approval controls while required configuration or eligibility evidence is absent.

## 18. Decisions and samples required before coding

Only the following tenant-specific inputs are required.

### Decision A — adviser administration visibility

Choose whether active workspace owners/admins may read every participant record.

**Recommended default:** yes, for programme administration and safeguarding, with audited access. Advisers remain caseload-restricted.

### Decision B — canonical participant display

Choose whether the application displays a participant's full name, preferred name, case reference, or a configured combination.

**Recommended default:** preferred/display name plus a non-sensitive tenant case reference; do not use national identifiers.

### Decision C — geography reference types

Provide the reference types used independently for:

- residency evidence;
- participant vacancy-search area;
- programme service-delivery area;
- vacancy work location.

**Recommended default:** tenant-approved local-authority or postcode-district reference data with an explicit version. Do not infer residency from postcode overlap and do not add an external geocoder in the foundation.

### Decision D — eligibility rules and evidence

Provide:

- current rule wording;
- effective date;
- required evidence types;
- review/expiry rules;
- authorised exception categories and approver role.

**Recommended default:** missing, expired, conflicting or unmapped evidence yields `needs_review`; exceptions require owner/admin authorization and effective dates.

### Decision E — outcome vocabulary

Provide the organisation's outcome keys, labels, effective dates, required evidence and report-category mappings.

**Recommended default:** import the existing approved vocabulary unchanged. Do not map draft approval, provider acceptance or match acceptance to an outcome.

### Decision F — sample spreadsheet columns

Provide sanitized header rows and 3-5 synthetic example rows for each existing sheet used for:

- employers;
- employer contacts;
- vacancies;
- participants;
- adviser/caseload assignments;
- eligibility evidence or exceptions;
- outcomes.

**Recommended default:** samples contain synthetic data only and include the stable source key used to detect updates and duplicates. REV will propose mappings after seeing these headers; no source column names are assumed now.

### Decision G — communication templates and sender identity

Provide sanitized current templates, placeholder definitions, tenant branding and the sender display/reply identity that should appear during review.

**Recommended default:** one active versioned branding profile and one active versioned sender identity per programme. They affect draft review only and grant no sending authority.

### Decision H — voice retention

Choose whether future raw audio or transcripts may be retained and for how long.

**Recommended default:** retain neither raw audio nor transcript after the adviser confirms the structured update, unless an approved legal/operational requirement says otherwise.


## Agreed Service-user implementation order — 15 October 2026
[REV-SERVICE-USER-PLAN-20261015]

Status: agreed future requirements, not implemented capabilities.
Current caseload UI has passed 58 focused tests and the full local build.
User prefers short wording, clear local save confirmation and minimal clutter.

Implementation order:
1. Finish caseload-to-record navigation. Open the existing authorised
   Service-user profile with that programme's case notes automatically
   visible, newest first. Keep author and programme-timezone timestamps.
   Verify, commit the scoped checkpoint and check CI.
2. Add persistent contact details through additive schema and trusted writes.
3. Define purpose, restricted permissions, retention and audit requirements
   for justice-support information before collecting it.
4. Add one private Documents area per programme record: CV, vocational
   profile, action plan, initial/final assessments and restricted disclosure
   letters. Include uploader, timestamp, category, versions, open/download.
   Notes may link to files without duplicating uploads. Do not silently
   overwrite files. Disclosure uploads depend on restricted access being ready.
5. Add structured vocational profiles, agreed action plans and initial/final
   assessments. Reuse existing identity and programme enrolment architecture.
6. Add editable quarterly AI report drafts from authorised dated records.
   Show source references and missing evidence. Preserve original notes;
   require ES review before export. Provider and spending limits remain
   separate configuration work.
7. Connect reviewed profiles to approved job, apprenticeship and training
   sources, with evidence-backed suggestions and human approval.

Search requirement:
Provide a simple Service-user search bar in REV using authorised records.
Support partial names, case references and names containing spaces.
Reuse the existing record view; do not create a duplicate profile.
Do not expose other workspaces, programmes or unassigned caseload records.

Restricted information:
Justice-support details may include necessary probation contacts, licence
dates, work/location restrictions and exclusion zones, only after purpose
and access are defined. Offence details and disclosure letters must not be
unrestricted fields or enter AI processing, employer outreach or standard
exports by default. Do not disclose anything to employers automatically.

Preserve exact save retries, tenant isolation, active caseload permissions,
existing notes and attribution. Distinguish loading, read failure and no notes.
Keep current folder, branch, localhost:5180, authentication, Scheduling,
email and unrelated uncommitted work unchanged.

This plan does not enable providers, sending, matching, uploads or reporting.
