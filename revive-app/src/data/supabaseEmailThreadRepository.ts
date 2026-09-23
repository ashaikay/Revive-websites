import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseClient } from './supabaseClient';

export type EmailDirection = 'inbound' | 'outbound';

export interface LiveEmailMessage {
  id: string;
  workspaceId: string;
  threadId: string;
  direction: EmailDirection;
  senderEmail: string;
  recipientEmails: string[];
  subject?: string;
  bodyText?: string;
  communicationAt: string;
}

export interface LiveEmailThread {
  id: string;
  workspaceId: string;
  contactId?: string;
  opportunityId?: string;
  subject?: string;
  lastMessageAt?: string;
  messages: LiveEmailMessage[];
}

type QueryResult = { data: Record<string, unknown>[] | null; error: { message: string } | null };

export interface LiveEmailThreadGateway {
  listThreads(workspaceId: string): Promise<QueryResult>;
  listMessages(workspaceId: string, threadIds: string[]): Promise<QueryResult>;
}

function requiredClient(): SupabaseClient {
  if (!supabaseClient) {
    throw new Error('Supabase mode requires browser-safe public client configuration.');
  }
  return supabaseClient;
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function mapMessage(row: Record<string, unknown>): LiveEmailMessage {
  const direction = String(row.direction) as EmailDirection;
  const communicationAt = direction === 'inbound'
    ? optionalString(row.received_at) ?? String(row.created_at)
    : optionalString(row.sent_at) ?? String(row.created_at);

  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    threadId: String(row.thread_id),
    direction,
    senderEmail: String(row.sender_email),
    recipientEmails: Array.isArray(row.recipient_emails) ? row.recipient_emails.map(String) : [],
    subject: optionalString(row.subject),
    bodyText: optionalString(row.body_text),
    communicationAt,
  };
}

function mapThread(row: Record<string, unknown>): LiveEmailThread {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    contactId: optionalString(row.contact_id),
    opportunityId: optionalString(row.opportunity_id),
    subject: optionalString(row.subject),
    lastMessageAt: optionalString(row.last_message_at),
    messages: [],
  };
}

export const browserSupabaseEmailThreadGateway: LiveEmailThreadGateway = {
  async listThreads(workspaceId) {
    return requiredClient()
      .from('rev_email_threads')
      .select('id,workspace_id,contact_id,opportunity_id,subject,last_message_at')
      .eq('workspace_id', workspaceId)
      .order('last_message_at', { ascending: false })
      .limit(20) as unknown as Promise<QueryResult>;
  },

  async listMessages(workspaceId, threadIds) {
    return requiredClient()
      .from('rev_email_messages')
      .select('id,workspace_id,thread_id,direction,sender_email,recipient_emails,subject,body_text,received_at,sent_at,created_at')
      .eq('workspace_id', workspaceId)
      .in('thread_id', threadIds) as unknown as Promise<QueryResult>;
  },
};

export class SupabaseEmailThreadRepository {
  constructor(private readonly gateway: LiveEmailThreadGateway = browserSupabaseEmailThreadGateway) {}

  async list(workspaceId: string): Promise<LiveEmailThread[]> {
    const threadResult = await this.gateway.listThreads(workspaceId);
    if (threadResult.error) {
      throw new Error(`Failed to load email conversation history: ${threadResult.error.message}`);
    }

    const threads = (threadResult.data ?? []).map(mapThread)
      .sort((left, right) => (right.lastMessageAt ?? '').localeCompare(left.lastMessageAt ?? ''));
    if (threads.length === 0) return [];

    const messageResult = await this.gateway.listMessages(workspaceId, threads.map((thread) => thread.id));
    if (messageResult.error) {
      throw new Error(`Failed to load email conversation messages: ${messageResult.error.message}`);
    }

    const messagesByThread = new Map<string, LiveEmailMessage[]>();
    for (const row of messageResult.data ?? []) {
      const message = mapMessage(row);
      const messages = messagesByThread.get(message.threadId) ?? [];
      messages.push(message);
      messagesByThread.set(message.threadId, messages);
    }

    return threads.map((thread) => ({
      ...thread,
      messages: (messagesByThread.get(thread.id) ?? [])
        .sort((left, right) => left.communicationAt.localeCompare(right.communicationAt)),
    }));
  }
}
