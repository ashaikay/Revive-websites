import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../supabase/migrations/20261010100000_rev_programme_hub_employer_foundation.sql', import.meta.url), 'utf8');
const architecture = readFileSync(new URL('../../../REVIVE_AI_MASTER/01_ARCHITECTURE/OUTCOMES_PROGRAMME_HUB_EMPLOYER_ENGAGEMENT_IPS.md', import.meta.url), 'utf8');

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
});
