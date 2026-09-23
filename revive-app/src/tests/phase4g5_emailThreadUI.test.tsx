import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  classifyEmailThread,
  EmailConversationHistory,
  emailBodyPreview,
  triageEmailThreads,
} from '@/components/REVInterface';
import { LiveEmailThread } from '@/data/supabaseEmailThreadRepository';

function thread(
  id: string,
  senderEmail: string,
  subject: string,
  lastMessageAt: string,
  overrides: Partial<LiveEmailThread> = {},
): LiveEmailThread {
  return {
    id,
    workspaceId: 'workspace-1',
    subject,
    lastMessageAt,
    messages: [{
      id: `${id}-message`, workspaceId: 'workspace-1', threadId: id, direction: 'inbound', senderEmail,
      recipientEmails: ['team@example.com'], subject, bodyText: 'A concise message.', communicationAt: lastMessageAt,
    }],
    ...overrides,
  };
}

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

  it('keeps every linked thread in customer conversations, including noreply mail', () => {
    const linkedNoreply = thread('linked-noreply', 'noreply@linkedin.com', 'LinkedIn notification', '2026-09-23T10:00:00.000Z', {
      contactId: 'contact-1',
    });
    expect(classifyEmailThread(linkedNoreply)).toBe('customer');
    expect(triageEmailThreads([linkedNoreply]).customer).toEqual([linkedNoreply]);
  });

  it('treats only the Buffer automated-mail domain as automated and preserves linked-thread priority', () => {
    const unlinkedBuffer = thread('buffer', 'hello@buffermail.com', 'NEW: Schedule Substack Notes in Buffer', '2026-09-23T10:00:00.000Z');
    const unknownHello = thread('unknown-hello', 'hello@unknown-business.example', 'Hello from our team', '2026-09-23T09:00:00.000Z');
    const linkedBuffer = thread('linked-buffer', 'hello@buffermail.com', 'NEW: Schedule Substack Notes in Buffer', '2026-09-23T08:00:00.000Z', {
      contactId: 'contact-1',
    });

    expect(classifyEmailThread(unlinkedBuffer)).toBe('automated');
    expect(classifyEmailThread(unknownHello)).toBe('needs_review');
    expect(classifyEmailThread(linkedBuffer)).toBe('customer');
  });

  it('keeps unlinked human-looking and mixed-signal threads in needs review', () => {
    const ordinary = thread('ordinary', 'sam@example.com', 'Could we discuss a quote?', '2026-09-23T10:00:00.000Z');
    const mixed = thread('mixed', 'noreply@linkedin.com', 'LinkedIn notification', '2026-09-23T09:00:00.000Z', {
      messages: [
        thread('automated-message', 'noreply@linkedin.com', 'LinkedIn notification', '2026-09-23T09:00:00.000Z').messages[0],
        thread('human-message', 'alex@example.com', 'Interested in your service', '2026-09-23T08:00:00.000Z').messages[0],
      ],
    });
    const triage = triageEmailThreads([ordinary, mixed]);
    expect(triage.needs_review.map((item) => item.id)).toEqual(['ordinary', 'mixed']);
    expect(triage.automated).toEqual([]);
  });

  it('places unlinked LinkedIn and DMARC notifications only in collapsed automated mail', () => {
    const linkedin = thread('linkedin', 'noreply@linkedin.com', 'LinkedIn platform digest', '2026-09-23T10:00:00.000Z');
    const dmarc = thread('dmarc', 'reports@example.net', 'DMARC report for example.com', '2026-09-23T09:00:00.000Z');
    const triage = triageEmailThreads([linkedin, dmarc]);
    const markup = renderToStaticMarkup(
      <EmailConversationHistory threads={[linkedin, dmarc]} contacts={[]} opportunities={[]} />,
    );

    expect(triage.automated.map((item) => item.id)).toEqual(['linkedin', 'dmarc']);
    expect(triage.needs_review).toEqual([]);
    expect(markup).toContain('<details>');
    expect(markup).toContain('AUTOMATED MAIL (2)');
    expect(markup).not.toContain('<details open');
  });

  it('retains newest-first ordering within each triage category', () => {
    const triage = triageEmailThreads([
      thread('review-older', 'a@example.com', 'Hello', '2026-09-23T08:00:00.000Z'),
      thread('customer-older', 'noreply@linkedin.com', 'Linked alert', '2026-09-23T07:00:00.000Z', { contactId: 'contact-1' }),
      thread('automated-older', 'noreply@linkedin.com', 'Newsletter', '2026-09-23T06:00:00.000Z'),
      thread('review-newer', 'b@example.com', 'Question', '2026-09-23T11:00:00.000Z'),
      thread('customer-newer', 'noreply@linkedin.com', 'Linked alert', '2026-09-23T10:00:00.000Z', { opportunityId: 'opportunity-1' }),
      thread('automated-newer', 'postmaster@example.net', 'Delivery report', '2026-09-23T09:00:00.000Z'),
    ]);
    expect(triage.customer.map((item) => item.id)).toEqual(['customer-newer', 'customer-older']);
    expect(triage.needs_review.map((item) => item.id)).toEqual(['review-newer', 'review-older']);
    expect(triage.automated.map((item) => item.id)).toEqual(['automated-newer', 'automated-older']);
  });

  it('renders the truthful empty state', () => {
    const markup = renderToStaticMarkup(
      <EmailConversationHistory threads={[]} contacts={[]} opportunities={[]} />,
    );
    expect(markup).toContain('No email conversation history is recorded for this workspace.');
  });
});