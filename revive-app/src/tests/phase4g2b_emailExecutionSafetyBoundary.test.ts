import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve('supabase/functions/rev-email-execute/index.ts'),
  'utf8',
);

describe('Phase 4G.2B email execution Edge Function safety boundary', () => {
  it('accepts only workspaceId and actionId as caller execution inputs', () => {
    expect(source).toContain('workspaceId?: unknown');
    expect(source).toContain('actionId?: unknown');

    expect(source).not.toContain('recipient?: unknown');
    expect(source).not.toContain('subject?: unknown');
    expect(source).not.toContain('body?: unknown');
    expect(source).not.toContain('approvalId?: unknown');
    expect(source).not.toContain('providerKey?: unknown');
  });

  it('derives recipient and approved content from workspace-scoped data', () => {
    expect(source).toContain(".from('rev_actions')");
    expect(source).toContain(".from('contacts')");
    expect(source).toContain(".from('contact_suppressions')");
    expect(source).toContain('recipient: String(contact.email)');
    expect(source).toContain('subject: String(action.title)');
    expect(source).toContain('body: String(action.description)');
  });

  it('creates the durable SEND_APPROVED_EMAIL reservation', () => {
    expect(source).toContain(
      "userClient.rpc('prepare_rev_action_execution'",
    );
    expect(source).toContain(
      "target_capability: 'SEND_APPROVED_EMAIL'",
    );
    expect(source).toContain(
      "target_provider_key: 'microsoft_graph'",
    );
  });

  it('keeps provider execution disabled', () => {
    expect(source).toContain("status: 'provider_disabled'");
    expect(source).toContain('executionEnabled: false');
    expect(source).toContain('providerInvoked: false');
    expect(source).toContain('emailSent: false');
    expect(source).toContain('DRY RUN — NOTHING SENT');
  });

  it('does not contain service-role provider claim or result recording', () => {
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).not.toContain('claim_rev_action_provider_attempt');
    expect(source).not.toContain('record_email_execution_result');
    expect(source).not.toContain('sendMicrosoftGraphEmail');
  });
});
