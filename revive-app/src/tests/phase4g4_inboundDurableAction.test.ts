import { describe, expect, it, vi } from 'vitest';
import { createInboundDurableAction } from '../../supabase/functions/rev-email-inbound/inboundDurableAction';

describe('Phase 4G.4 inbound durable action', () => {
  it('creates the action through the atomic database RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        action_id: 'action-1',
        created: true,
      }],
      error: null,
    });

    const result = await createInboundDurableAction(
      { rpc },
      {
        workspaceId: 'workspace-1',
        messageId: 'message-1',
      },
    );

    expect(rpc).toHaveBeenCalledWith(
      'create_inbound_rev_action',
      {
        target_workspace_id: 'workspace-1',
        target_message_id: 'message-1',
      },
    );

    expect(result).toEqual({
      status: 'created',
      actionId: 'action-1',
    });
  });

  it('returns the existing action when the RPC reports it already exists', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        action_id: 'action-existing',
        created: false,
      }],
      error: null,
    });

    const result = await createInboundDurableAction(
      { rpc },
      {
        workspaceId: 'workspace-1',
        messageId: 'message-1',
      },
    );

    expect(result).toEqual({
      status: 'already_exists',
      actionId: 'action-existing',
    });
  });

  it('fails closed when the RPC returns an error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'RPC rejected request',
      },
    });

    await expect(
      createInboundDurableAction(
        { rpc },
        {
          workspaceId: 'workspace-1',
          messageId: 'message-1',
        },
      ),
    ).rejects.toThrow(
      'Failed to create durable inbound REV action: RPC rejected request',
    );
  });
});
