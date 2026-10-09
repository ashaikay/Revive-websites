# Outcomes / Programme Hub — Employer Engagement / IPS Foundation

**Status:** Canonical architecture plus the first tenant-neutral foundation implemented locally. The local slice includes programme configuration, employer/contact records, vacancies, minimal participant employment profiles, explicit programme advisers and participant caseload assignments. Matching, outreach drafts, outcomes, reporting, imports and voice updates remain extension points. Nothing is deployed and no provider call, outreach or execution-gate change is included.

**Provenance:** This is the pre-existing 21 September 2026 employment-support plan, clarified on 8 October 2026. It is not a new module.

## 1. Product placement and boundaries

Employer Engagement belongs inside **Outcomes / Programme Hub** for employment-support and Individual Placement and Support (IPS) organisations.

It is not:

- commercial GROWTH lead generation, revenue pipeline or REV attribution;
- the worker Scheduling domain used for employees, shifts, availability, sickness or Annual Leave;
- an email execution capability;
- a clinical record or health case-management system.

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
6. Add version-bound draft review with **Approved — not sent** only.
7. Add explicit outcome entry/correction and traceable reporting.
8. Run focused, mounted, boundary and isolated database validation.

Provider delivery, live outreach, generic spreadsheet ingestion, voice capture and deployment require separate authorization.

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
