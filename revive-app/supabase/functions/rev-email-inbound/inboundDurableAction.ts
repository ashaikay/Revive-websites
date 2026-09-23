export interface InboundDurableActionClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

export interface CreateInboundDurableActionInput {
  workspaceId: string;
  messageId: string;
}

export interface InboundDurableActionResult {
  status: 'created' | 'already_exists';
  actionId: string;
}

export async function createInboundDurableAction(
  client: InboundDurableActionClient,
  input: CreateInboundDurableActionInput,
): Promise<InboundDurableActionResult> {
  const { data, error } = await client.rpc(
    'create_inbound_rev_action',
    {
      target_workspace_id: input.workspaceId,
      target_message_id: input.messageId,
    },
  );

  if (error) {
    throw new Error(
      `Failed to create durable inbound REV action: ${
        error.message ?? 'unknown RPC error'
      }`,
    );
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (
    !row ||
    typeof row !== 'object' ||
    !('action_id' in row) ||
    typeof row.action_id !== 'string'
  ) {
    throw new Error('Durable inbound REV action RPC returned no action ID');
  }

  return {
    status:
      'created' in row && row.created === true
        ? 'created'
        : 'already_exists',
    actionId: row.action_id,
  };
}
