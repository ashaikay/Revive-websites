# Quotes Protection Baseline

**Captured:** 2026-09-12
**Project:** Revive Websites
**Project ref:** `ntbowgutwyyhhnmkadlv`
**Source:** Redacted schema-only dump of the live `public` schema

## Table

**Object:** `public.quotes`

| Column | Type | Nullability | Default |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `full_name` | `text` | NOT NULL | none |
| `business_name` | `text` | nullable | none |
| `email` | `text` | NOT NULL | none |
| `phone` | `text` | nullable | none |
| `contact_method` | `text` | NOT NULL | `'email'` |
| `project_type` | `text` | nullable | none |
| `current_url` | `text` | nullable | none |
| `business_type` | `text` | nullable | none |
| `target_audience` | `text` | nullable | none |
| `page_count` | `text` | nullable | none |
| `budget` | `text` | nullable | none |
| `pages_needed` | `text[]` | nullable | none |
| `features_needed` | `text[]` | nullable | none |
| `branding_ready` | `text` | nullable | none |
| `content_ready` | `text` | nullable | none |
| `assets_ready` | `text` | nullable | none |
| `launch_date` | `date` | nullable | none |
| `start_soon` | `text` | nullable | none |
| `deposit_ok` | `text` | nullable | none |
| `project_details` | `text` | nullable | none |
| `status` | `text` | NOT NULL | `'new'` |
| `selected_package` | `text` | nullable | none |
| `payment_option` | `text` | nullable | none |
| `payment_link_label` | `text` | nullable | none |
| `maintenance_plan` | `text` | nullable | none |
| `design_addons` | `text[]` | nullable | none |
| `payment_status` | `text` | nullable | `'unpaid'` |
| `consultation_status` | `text` | nullable | `'not_booked'` |

### Constraints

- Primary key: `quotes_pkey` on `id`
- Foreign keys: none discovered
- Unique constraints beyond the primary key: none discovered
- Estimated row count at inspection: `0`

## RLS and Policies

- RLS: **enabled** on `public.quotes`
- `allow public inserts`: role `anon`, command `INSERT`, `WITH CHECK (true)`
- `allow authenticated reads`: role `authenticated`, command `SELECT`, `USING (true)`
- No broader policy should be inferred for other commands or roles.

The policies are intentionally recorded exactly as observed. Their broad expressions are role-scoped and must be reviewed separately before future security changes.

## Indexes

- `quotes_pkey`: primary-key btree index on `id`
- `idx_quotes_created_at`: btree index on `created_at DESC`
- `idx_quotes_status`: btree index on `status`

## Trigger

- **Name:** `quotes-telegram-alert`
- **Timing/event:** `AFTER INSERT`, `FOR EACH ROW`
- **Target:** `supabase_functions.http_request`
- **URL:** `https://ntbowgutwyyhhnmkadlv.supabase.co/functions/v1/telegram-alert-ts`
- **Method:** `POST`
- **Payload:** JSON body argument `{}` at the trigger helper level, preserving the existing webhook helper behavior.
- **Authentication:** Existing Authorization value is a legacy service-role JWT and is redacted as `<REDACTED_LEGACY_SERVICE_ROLE_JWT>` in the backup. Do not copy or reproduce it.
- **Timeout:** `5000` milliseconds

## Edge Function

- **Name:** `telegram-alert-ts`
- **Status:** `ACTIVE`
- **Version:** `1`
- **JWT verification:** `true`
- **Purpose:** Receive quote webhook payloads and send Telegram notifications using deployed Telegram secrets.

## Protection Rule

> Future REV migrations must not drop, rename, replace, broaden access to, or otherwise modify `public.quotes` or its existing production quote/Telegram workflow unless separately reviewed and explicitly approved.

This baseline is documentation only. No quote table, policy, index, trigger, Edge Function, secret, or marketing behavior was changed.
