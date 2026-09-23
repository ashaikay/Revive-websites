export interface InboundContactCandidate {
  id: string;
  workspace_id: string;
  email: string | null;
}

export type InboundContactMatch =
  | {
      status: 'matched';
      contactId: string;
    }
  | {
      status: 'needs_review';
      reason: 'no_match' | 'ambiguous_match';
    };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Matches an inbound sender to a contact inside one workspace.
 *
 * Safety rules:
 * - never match across workspaces;
 * - email comparison is normalized;
 * - exactly one match is required;
 * - zero matches require review;
 * - multiple matches require review;
 * - never guesses which contact is correct.
 */
export function matchInboundContact(
  workspaceId: string,
  senderEmail: string,
  contacts: InboundContactCandidate[],
): InboundContactMatch {
  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedSenderEmail = normalizeEmail(senderEmail);

  if (!normalizedWorkspaceId || !normalizedSenderEmail) {
    return {
      status: 'needs_review',
      reason: 'no_match',
    };
  }

  const matches = contacts.filter((contact) => {
    if (contact.workspace_id !== normalizedWorkspaceId) {
      return false;
    }

    if (typeof contact.email !== 'string') {
      return false;
    }

    return normalizeEmail(contact.email) === normalizedSenderEmail;
  });

  if (matches.length === 0) {
    return {
      status: 'needs_review',
      reason: 'no_match',
    };
  }

  if (matches.length > 1) {
    return {
      status: 'needs_review',
      reason: 'ambiguous_match',
    };
  }

  return {
    status: 'matched',
    contactId: matches[0].id,
  };
}