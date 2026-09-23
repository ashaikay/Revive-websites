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
      "'prepare_rev_action_execution'",
    );

    expect(source).toMatch(
      /target_capability:\s*['"]SEND_APPROVED_EMAIL['"]/,
    );

    expect(source).toMatch(
      /target_provider_key:\s*['"]microsoft_graph['"]/,
    );
  });

  it('keeps the provider activation gate hard-disabled before live execution', () => {
    expect(source).toContain(
      'const PROVIDER_EXECUTION_ENABLED = false;',
    );

    expect(source).toContain(
      'if (!PROVIDER_EXECUTION_ENABLED)',
    );

    expect(source).toContain(
      "status: 'provider_disabled'",
    );

    expect(source).toContain(
      'executionEnabled: false',
    );

    expect(source).toContain(
      'providerInvoked: false',
    );

    expect(source).toContain(
      'emailSent: false',
    );

    expect(source).toContain(
      'DRY RUN - NOTHING SENT',
    );
  });

  it('keeps all privileged provider execution structurally below the disabled gate', () => {
    const gateIndex = source.indexOf(
      'if (!PROVIDER_EXECUTION_ENABLED)',
    );

    const serviceRoleIndex = source.indexOf(
      "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')",
    );

    const dependencyCreationIndex = source.indexOf(
      'createMicrosoftGraphExecutionDependencies({',
    );

    const providerExecutionIndex = source.indexOf(
      'executeMicrosoftGraphEmail(',
    );

    expect(gateIndex).toBeGreaterThan(-1);
    expect(serviceRoleIndex).toBeGreaterThan(gateIndex);
    expect(dependencyCreationIndex).toBeGreaterThan(gateIndex);
    expect(providerExecutionIndex).toBeGreaterThan(gateIndex);

    expect(source).not.toMatch(
      /\.rpc\(\s*['"]claim_rev_action_provider_attempt['"]/,
    );

    expect(source).not.toMatch(
      /\.rpc\(\s*['"]record_email_execution_result['"]/,
    );

    expect(source).not.toMatch(
      /\bsendMicrosoftGraphEmail\s*\(/,
    );
  });
});
