import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmailConversationHistory } from '@/components/REVInterface';

describe('Phase 4G.5 email conversation history UI', () => {
  it('renders a read-only conversation history without reply, send, execute, compose, or provider controls', () => {
    const markup = renderToStaticMarkup(
      <EmailConversationHistory
        contacts={[{ id: 'contact-1', workspaceId: 'workspace-1', lifecycle: 'lead', name: 'Ada Lovelace', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }]}
        opportunities={[{ id: 'opportunity-1', title: 'Website redesign' }]}
        threads={[{
          id: 'thread-1', workspaceId: 'workspace-1', contactId: 'contact-1', opportunityId: 'opportunity-1', subject: 'Project update', lastMessageAt: '2026-09-23T10:00:00.000Z',
          messages: [{ id: 'message-1', workspaceId: 'workspace-1', threadId: 'thread-1', direction: 'inbound', senderEmail: 'ada@example.com', recipientEmails: ['team@example.com'], subject: 'Project update', bodyText: 'First line\nSecond line', communicationAt: '2026-09-23T10:00:00.000Z' }],
        }]}
      />,
    );

    expect(markup).toContain('EMAIL CONVERSATIONS');
    expect(markup).toContain('READ-ONLY HISTORY');
    expect(markup).toContain('Ada Lovelace');
    expect(markup).toContain('Website redesign');
    expect(markup).toContain('INBOUND');
    expect(markup).not.toMatch(/<button[^>]*>(?:[^<]*(?:Reply|Send|Execute|Compose|Provider)[^<]*)<\/button>/i);
  });

  it('renders the truthful empty state', () => {
    const markup = renderToStaticMarkup(
      <EmailConversationHistory threads={[]} contacts={[]} opportunities={[]} />,
    );
    expect(markup).toContain('No email conversation history is recorded for this workspace.');
  });
});