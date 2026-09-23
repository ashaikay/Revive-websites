import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  LiveEmailThreadGateway,
  SupabaseEmailThreadRepository,
} from '@/data/supabaseEmailThreadRepository';

class ReadOnlyGateway implements LiveEmailThreadGateway {
  threadCalls: string[] = [];
  messageCalls: Array<{ workspaceId: string; threadIds: string[] }> = [];
  threadError: { message: string } | null = null;
  messageError: { message: string } | null = null;
  threads: Record<string, unknown>[] = [];
  messages: Record<string, unknown>[] = [];

  async listThreads(workspaceId: string) {
    this.threadCalls.push(workspaceId);
    return { data: this.threads, error: this.threadError };
  }

  async listMessages(workspaceId: string, threadIds: string[]) {
    this.messageCalls.push({ workspaceId, threadIds });
    return { data: this.messages, error: this.messageError };
  }
}

describe('Phase 4G.5 email thread repository', () => {
  it('uses explicitly workspace-scoped browser reads without writes, RPCs, or provider invocation', () => {
    const source = readFileSync(
      new URL('../data/supabaseEmailThreadRepository.ts', import.meta.url),
      'utf8',
    );

    expect(source.match(/\.eq\('workspace_id', workspaceId\)/g)).toHaveLength(2);
    expect(source).toContain(".in('thread_id', threadIds)");
    expect(source).toContain(".order('last_message_at', { ascending: false })");
    expect(source).toContain('.limit(20)');
    expect(source).not.toMatch(/\.(?:insert|update|delete|upsert|rpc)\(/);
    expect(source).not.toContain('.functions.invoke(');
  });

  it('uses only explicitly workspace-scoped reads, limits thread messages to loaded thread IDs, and keeps newest threads first', async () => {
    const gateway = new ReadOnlyGateway();
    gateway.threads = [
      { id: 'older', workspace_id: 'workspace-1', subject: 'Older', last_message_at: '2026-09-20T09:00:00.000Z' },
      { id: 'newer', workspace_id: 'workspace-1', subject: 'Newer', last_message_at: '2026-09-21T09:00:00.000Z' },
    ];
    gateway.messages = [
      { id: 'message-1', workspace_id: 'workspace-1', thread_id: 'newer', direction: 'inbound', sender_email: 'person@example.com', recipient_emails: ['team@example.com'], created_at: '2026-09-21T09:00:00.000Z', received_at: '2026-09-21T10:00:00.000Z' },
      { id: 'message-2', workspace_id: 'workspace-1', thread_id: 'newer', direction: 'outbound', sender_email: 'team@example.com', recipient_emails: ['person@example.com'], created_at: '2026-09-21T12:00:00.000Z', sent_at: '2026-09-21T11:00:00.000Z' },
    ];

    const result = await new SupabaseEmailThreadRepository(gateway).list('workspace-1');

    expect(gateway.threadCalls).toEqual(['workspace-1']);
    expect(gateway.messageCalls).toEqual([{ workspaceId: 'workspace-1', threadIds: ['newer', 'older'] }]);
    expect(result.map((thread) => thread.id)).toEqual(['newer', 'older']);
    expect(result[0].messages.map((message) => message.id)).toEqual(['message-1', 'message-2']);
    expect(result[0].messages[0].communicationAt).toBe('2026-09-21T10:00:00.000Z');
    expect(result[0].messages[1].communicationAt).toBe('2026-09-21T11:00:00.000Z');
  });

  it('falls back to created_at only when the direction-specific communication timestamp is absent', async () => {
    const gateway = new ReadOnlyGateway();
    gateway.threads = [{ id: 'thread-1', workspace_id: 'workspace-1', last_message_at: '2026-09-21T12:00:00.000Z' }];
    gateway.messages = [
      { id: 'outbound', workspace_id: 'workspace-1', thread_id: 'thread-1', direction: 'outbound', sender_email: 'team@example.com', recipient_emails: [], created_at: '2026-09-21T11:00:00.000Z' },
      { id: 'inbound', workspace_id: 'workspace-1', thread_id: 'thread-1', direction: 'inbound', sender_email: 'person@example.com', recipient_emails: [], created_at: '2026-09-21T10:00:00.000Z' },
    ];

    const [thread] = await new SupabaseEmailThreadRepository(gateway).list('workspace-1');
    expect(thread.messages.map((message) => message.communicationAt)).toEqual(['2026-09-21T10:00:00.000Z', '2026-09-21T11:00:00.000Z']);
  });

  it('does not query messages when no workspace-scoped threads exist', async () => {
    const gateway = new ReadOnlyGateway();
    await expect(new SupabaseEmailThreadRepository(gateway).list('workspace-1')).resolves.toEqual([]);
    expect(gateway.messageCalls).toEqual([]);
  });

  it('fails closed when either read query fails', async () => {
    const threadFailure = new ReadOnlyGateway();
    threadFailure.threadError = { message: 'thread read denied' };
    await expect(new SupabaseEmailThreadRepository(threadFailure).list('workspace-1')).rejects.toThrow('Failed to load email conversation history: thread read denied');

    const messageFailure = new ReadOnlyGateway();
    messageFailure.threads = [{ id: 'thread-1', workspace_id: 'workspace-1' }];
    messageFailure.messageError = { message: 'message read denied' };
    await expect(new SupabaseEmailThreadRepository(messageFailure).list('workspace-1')).rejects.toThrow('Failed to load email conversation messages: message read denied');
  });
});
