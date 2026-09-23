import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmailConversationHistory, emailBodyPreview } from '@/components/REVInterface';

describe('Phase 4G.5 email conversation history UI', () => {
  it('renders short messages fully and keeps the conversation history read-only', () => {
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
    expect(markup).toContain('First line Second line');
    expect(markup).not.toContain('View full message');
    expect(markup).not.toMatch(/<button[^>]*>(?:[^<]*(?:Reply|Send|Execute|Compose|Provider)[^<]*)<\/button>/i);
  });

  it('truncates long default previews and adds disclosure only for long bodies', () => {
    const longBody = `${'Marketing copy and tracking url '.repeat(12)}END`;
    const markup = renderToStaticMarkup(
      <EmailConversationHistory
        contacts={[]}
        opportunities={[]}
        threads={[{
          id: 'thread-long', workspaceId: 'workspace-1', subject: 'Newsletter', lastMessageAt: '2026-09-23T10:00:00.000Z',
          messages: [{ id: 'message-long', workspaceId: 'workspace-1', threadId: 'thread-long', direction: 'inbound', senderEmail: 'news@example.com', recipientEmails: ['team@example.com'], bodyText: longBody, communicationAt: '2026-09-23T10:00:00.000Z' }],
        }]}
      />,
    );

    expect(emailBodyPreview(longBody)).toHaveLength(243);
    expect(emailBodyPreview(longBody)).toMatch(/\.\.\.$/);
    expect(markup).toContain(emailBodyPreview(longBody));
    expect(markup).toContain('View full message');
    expect(markup).toContain('max-h-80');
    expect(markup).toContain('overflow-y-auto');
    expect(markup).toContain('break-words');
  });

  it('renders linked threads before unlinked threads while retaining newest-first order within each group', () => {
    const markup = renderToStaticMarkup(
      <EmailConversationHistory
        contacts={[{ id: 'contact-1', workspaceId: 'workspace-1', lifecycle: 'lead', name: 'Linked contact', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }]}
        opportunities={[]}
        threads={[
          { id: 'unlinked-newer', workspaceId: 'workspace-1', subject: 'Unlinked newer', lastMessageAt: '2026-09-23T12:00:00.000Z', messages: [] },
          { id: 'linked-older', workspaceId: 'workspace-1', contactId: 'contact-1', subject: 'Linked older', lastMessageAt: '2026-09-23T09:00:00.000Z', messages: [] },
          { id: 'linked-newer', workspaceId: 'workspace-1', contactId: 'contact-1', subject: 'Linked newer', lastMessageAt: '2026-09-23T11:00:00.000Z', messages: [] },
          { id: 'unlinked-older', workspaceId: 'workspace-1', subject: 'Unlinked older', lastMessageAt: '2026-09-23T08:00:00.000Z', messages: [] },
        ]}
      />,
    );

    expect(markup.indexOf('Linked newer')).toBeLessThan(markup.indexOf('Linked older'));
    expect(markup.indexOf('Linked older')).toBeLessThan(markup.indexOf('Unlinked newer'));
    expect(markup.indexOf('Unlinked newer')).toBeLessThan(markup.indexOf('Unlinked older'));
  });

  it('renders the truthful empty state', () => {
    const markup = renderToStaticMarkup(
      <EmailConversationHistory threads={[]} contacts={[]} opportunities={[]} />,
    );
    expect(markup).toContain('No email conversation history is recorded for this workspace.');
  });
});