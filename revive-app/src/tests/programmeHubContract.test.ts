import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../supabase/migrations/20261010100000_rev_programme_hub_employer_foundation.sql', import.meta.url), 'utf8');
const notesMigration = readFileSync(new URL('../../supabase/migrations/20261010110000_rev_programme_hub_participant_notes.sql', import.meta.url), 'utf8');
const engagementMigration = readFileSync(new URL('../../supabase/migrations/20261011010000_rev_programme_employer_discovery_engagement.sql', import.meta.url), 'utf8');
const architecture = readFileSync(new URL('../../../REVIVE_AI_MASTER/01_ARCHITECTURE/OUTCOMES_PROGRAMME_HUB_EMPLOYER_ENGAGEMENT_IPS.md', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('../components/Navigation.tsx', import.meta.url), 'utf8');
const supabaseConfig = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');

describe('Outcomes / Programme Hub contract', () => {
  it('keeps employer engagement distinct from commercial Growth and worker Scheduling', () => {
    expect(architecture).toContain('pre-existing 21 September 2026 employment-support plan');
    expect(architecture).toContain('It is not:');
    expect(architecture).toContain('commercial GROWTH lead generation');
    expect(architecture).toContain('worker Scheduling domain');
    expect(architecture).toContain('Approved — not sent');
  });

  it('enforces owner/admin programme access and adviser caseload access in database policy', () => {
    expect(migration).toContain("member.role in ('owner', 'admin')");
    expect(migration).toContain('programme_hub_participant_advisers assignment');
    expect(migration).toContain('assignment.adviser_user_id = member.user_id');
    expect(migration).toContain('create policy programme_hub_participants_read');
    expect(migration).toContain('public.can_access_rev_participant(workspace_id, id)');
  });

  it('uses service-only versioned writes, request replay and audit evidence', () => {
    expect(migration).toContain('rev_programme_hub_private.write_requests');
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(migration).toContain('expected_version');
    expect(migration).toContain('Programme request unavailable');
    expect(migration).toContain("'programme_hub.' || target_operation");
    expect(migration).toContain('grant execute on function public.save_rev_programme_hub_record');
    expect(migration).toContain('to service_role');
    expect(migration).toContain('from public, anon, authenticated');
  });

  it('keeps configurable contracts empty until tenant rules and vocabularies are supplied', () => {
    for (const contract of ['residency_eligibility', 'vacancy_search_geography', 'service_delivery_geography', 'outcome_vocabulary', 'spreadsheet_mapping']) {
      expect(migration).toContain(`'${contract}'`);
    }
    expect(migration).not.toContain('Avision');
    expect(migration).not.toContain('diagnosis');
    expect(migration).not.toContain('job_start');
  });

  it('uses the existing authenticated workspace without removing Scheduling or REV', () => {
    expect(app).toContain("<REVInterface workspaceId={currentWorkspaceId} />");
    expect(app).toContain('<SchedulingModule key={`${currentWorkspaceId}:${liveSession.userId}`} workspaceId={currentWorkspaceId} userId={liveSession.userId} />');
    expect(app).toContain('<ProgrammeHubModule key={`${currentWorkspaceId}:${liveSession.userId}`} workspaceId={currentWorkspaceId} userId={liveSession.userId} />');
    expect(navigation).toContain("{ label: 'REV', href: '#rev', id: 'rev' }");
    expect(navigation).toContain("{ label: 'OUTCOMES', href: '#programme', id: 'programme' }");
    expect(navigation).toContain("{ label: 'SCHEDULING', href: '#scheduling', id: 'scheduling' }");
    expect(supabaseConfig).toContain('[functions.rev-programme-hub-save]');
  });

  it('stores append-only participant notes with server authorship, caseload RLS and exact replay', () => {
    expect(notesMigration).toContain('create table public.programme_hub_participant_notes');
    expect(notesMigration).toContain('author_user_id uuid not null');
    expect(notesMigration).toContain('created_at timestamptz not null default now()');
    expect(notesMigration).toContain('public.can_access_rev_participant(workspace_id, participant_id)');
    expect(notesMigration).toContain('assignment.participant_id = target_participant_id');
    expect(notesMigration).toContain("prior.operation <> 'participant_note'");
    expect(notesMigration).toContain('return prior.result');
    expect(notesMigration).toContain('to service_role');
    expect(notesMigration).not.toContain('delete from public.programme_hub_participant_notes');
    expect(notesMigration).not.toContain('update public.programme_hub_participant_notes');
  });

  it('keeps employer discovery, engagement history and prepared outreach tenant-scoped and idempotent', () => {
    expect(engagementMigration).toContain('programme_hub_employer_discovery_searches');
    expect(engagementMigration).toContain('public.can_access_rev_programme(workspace_id, programme_id)');
    expect(engagementMigration).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(engagementMigration).toContain('provider_call_count integer not null default 1 check (provider_call_count = 1)');
    expect(engagementMigration).toContain('Programme request unavailable');
    expect(engagementMigration).toContain('Employer contact unavailable or suppressed');
    expect(engagementMigration).toContain("status text not null default 'prepared_not_sent'");
    expect(engagementMigration).toContain("'rev_prepared_not_sent'");
    expect(engagementMigration).not.toContain("'sent'");
    expect(supabaseConfig).toContain('[functions.rev-programme-employer-discovery]');
    expect(supabaseConfig).toContain('[functions.rev-programme-employer-engagement-save]');
    expect(supabaseConfig).toContain('[functions.rev-programme-employer-outreach-draft]');
  });
});
