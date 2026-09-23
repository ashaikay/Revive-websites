import { describe, expect, it } from 'vitest';

import {
  matchInboundContact,
  type InboundContactCandidate,
} from '../../supabase/functions/rev-email-inbound/inboundContactMatcher';

describe('Phase 4G.3 inbound contact matcher', () => {
  const workspaceA = 'workspace-a';
  const workspaceB = 'workspace-b';

  it('matches exactly one contact in the requested workspace', () => {
    const contacts: InboundContactCandidate[] = [
      {
        id: 'contact-1',
        workspace_id: workspaceA,
        email: 'customer@example.com',
      },
    ];

    expect(
      matchInboundContact(
        workspaceA,
        'customer@example.com',
        contacts,
      ),
    ).toEqual({
      status: 'matched',
      contactId: 'contact-1',
    });
  });

  it('normalizes email casing and surrounding whitespace', () => {
    const contacts: InboundContactCandidate[] = [
      {
        id: 'contact-1',
        workspace_id: workspaceA,
        email: ' Customer@Example.com ',
      },
    ];

    expect(
      matchInboundContact(
        workspaceA,
        ' CUSTOMER@example.COM ',
        contacts,
      ),
    ).toEqual({
      status: 'matched',
      contactId: 'contact-1',
    });
  });

  it('never matches a contact from another workspace', () => {
    const contacts: InboundContactCandidate[] = [
      {
        id: 'contact-other-workspace',
        workspace_id: workspaceB,
        email: 'customer@example.com',
      },
    ];

    expect(
      matchInboundContact(
        workspaceA,
        'customer@example.com',
        contacts,
      ),
    ).toEqual({
      status: 'needs_review',
      reason: 'no_match',
    });
  });

  it('requires review when there is no matching contact', () => {
    expect(
      matchInboundContact(
        workspaceA,
        'unknown@example.com',
        [],
      ),
    ).toEqual({
      status: 'needs_review',
      reason: 'no_match',
    });
  });

  it('requires review when multiple contacts match', () => {
    const contacts: InboundContactCandidate[] = [
      {
        id: 'contact-1',
        workspace_id: workspaceA,
        email: 'duplicate@example.com',
      },
      {
        id: 'contact-2',
        workspace_id: workspaceA,
        email: 'duplicate@example.com',
      },
    ];

    expect(
      matchInboundContact(
        workspaceA,
        'duplicate@example.com',
        contacts,
      ),
    ).toEqual({
      status: 'needs_review',
      reason: 'ambiguous_match',
    });
  });

  it('ignores contacts without an email address', () => {
    const contacts: InboundContactCandidate[] = [
      {
        id: 'contact-1',
        workspace_id: workspaceA,
        email: null,
      },
    ];

    expect(
      matchInboundContact(
        workspaceA,
        'customer@example.com',
        contacts,
      ),
    ).toEqual({
      status: 'needs_review',
      reason: 'no_match',
    });
  });

  it('fails closed when the workspace ID is empty', () => {
    expect(
      matchInboundContact(
        '',
        'customer@example.com',
        [],
      ),
    ).toEqual({
      status: 'needs_review',
      reason: 'no_match',
    });
  });

  it('fails closed when the sender email is empty', () => {
    expect(
      matchInboundContact(
        workspaceA,
        '',
        [],
      ),
    ).toEqual({
      status: 'needs_review',
      reason: 'no_match',
    });
  });
});