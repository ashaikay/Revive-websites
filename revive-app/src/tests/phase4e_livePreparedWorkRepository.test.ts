import { describe, expect, it, vi } from 'vitest';
import { seedData } from '@/data/seedFixtures';
import {
  LiveApproval,
  LivePreparedWorkContext,
  LivePreparedWorkGateway,
  LivePreparedWorkState,
  LiveREVAction,
  SupabasePreparedWorkRepository,
} from '@/data/supabasePreparedWorkRepository';
import { BusinessMemoryEventRecord, MemberRole } from '@/domain/models';
import { RecoveryCandidate } from '@/domain/recovery';
import { fingerprintREVAction } from '@/services/revActionFingerprint';

function candidate(overrides: Partial<RecoveryCandidate> = {}): RecoveryCandidate {
  return {
    id: 'recovery-dormant-opportunity-6', workspaceId: 'workspace-1', signalType: 'dormant_lead', supportStatus: 'supported',
    opportunityId: 'opportunity-6', contactId: 'contact-6', goalId: 'goal-1', estimatedRecoverableValue: 9000,
    confidence: 0.82, evidence: [{ type: 'fact', summary: 'Opportunity stage is dormant.', source: 'Opportunity record' }],
    reason: 'Dormant opportunity with recorded value and no active next step.', ageDays: 74, relationshipWarmth: 0.78,
    recommendedCapability: 'REVIEW_DORMANT_LEAD', safety: 'allowed', source: 'opportunity', ...overrides,
  };
}

class MemoryGateway implements LivePreparedWorkGateway {
  readonly state: LivePreparedWorkState = { actions: [], approvals: [], memories: [] };
  roleByUser = new Map<string, MemberRole>([
    ['owner-1', 'owner'], ['admin-1', 'admin'], ['member-1', 'member'], ['viewer-1', 'viewer'],
  ]);
  mutateBeforeDecision = false;
  providerInvocations = 0;

  async loadContext(workspaceId: string, actorUserId: string): Promise<LivePreparedWorkContext> {
    const role = this.roleByUser.get(actorUserId);
    return {
      membership: role ? { workspaceId, userId: actorUserId, role, status: 'active', joinedAt: '2026-09-15T00:00:00.000Z' } : undefined,
      profile: seedData.profiles.find((item) => item.workspaceId === workspaceId),
      services: seedData.services.filter((item) => item.workspaceId === workspaceId),
      goals: seedData.goals.filter((item) => item.workspaceId === workspaceId),
      contacts: seedData.contacts.filter((item) => item.workspaceId === workspaceId),
      opportunities: seedData.opportunities.filter((item) => item.workspaceId === workspaceId),
    };
  }

  async loadPreparedState(workspaceId: string): Promise<LivePreparedWorkState> {
    return {
      actions: structuredClone(this.state.actions.filter((item) => item.workspaceId === workspaceId)),
      approvals: structuredClone(this.state.approvals.filter((item) => item.workspaceId === workspaceId)),
      memories: structuredClone(this.state.memories.filter((item) => item.workspaceId === workspaceId)),
    };
  }

  async insertAction(action: LiveREVAction): Promise<void> {
    if (!this.state.actions.some((item) => item.id === action.id)) this.state.actions.push(structuredClone(action));
  }

  async insertApproval(approval: LiveApproval): Promise<void> {
    if (!this.state.approvals.some((item) => item.id === approval.id)) this.state.approvals.push(structuredClone(approval));
  }

  async insertMemory(event: BusinessMemoryEventRecord): Promise<void> {
    if (this.state.memories.some((item) => item.id === event.id)) return;
    const stored = event.structuredData.preparedFollowUp;
    if (!stored || typeof stored !== 'object') throw new Error('Missing prepared follow-up context.');
    this.state.memories.push({
      id: event.id, workspaceId: event.workspaceId, entityId: event.entityId!, occurredAt: event.occurredAt,
      stored: structuredClone(stored) as LivePreparedWorkState['memories'][number]['stored'],
    });
  }

  async updateAction(workspaceId: string, actionId: string, actionVersion: number, title: string, description: string): Promise<void> {
    const action = this.state.actions.find((item) => item.workspaceId === workspaceId && item.id === actionId && item.actionVersion === actionVersion);
    if (!action) throw new Error('Prepared follow-up changed before the edit could be saved.');
    action.title = title;
    action.description = description;
    action.actionVersion += 1;
    action.status = 'awaiting_approval';
    action.approvedAt = undefined;
  }

  async decideApproval(input: { approvalId: string; actionVersion: number; actionFingerprint: string; decision: 'approved' | 'rejected' }): Promise<void> {
    const approval = this.state.approvals.find((item) => item.id === input.approvalId);
    const action = approval ? this.state.actions.find((item) => item.id === approval.revActionId) : undefined;
    if (!approval || !action) throw new Error('approval not found');
    if (this.mutateBeforeDecision) {
      action.title = 'Concurrent material edit';
      action.actionVersion += 1;
    }
    const currentFingerprint = await fingerprintREVAction(action);
    if (action.actionVersion !== input.actionVersion || currentFingerprint !== input.actionFingerprint) throw new Error('stale approval review');
    if (approval.decision) throw new Error('approval is already decided');
    approval.decision = input.decision;
    approval.decidedAt = '2026-09-15T01:00:00.000Z';
    action.status = input.decision === 'approved' ? 'approved' : 'rejected';
    action.approvedAt = input.decision === 'approved' ? approval.decidedAt : undefined;
  }
}

function repository(gateway = new MemoryGateway()) {
  return { gateway, repository: new SupabasePreparedWorkRepository(gateway) };
}

describe('Phase 4E live prepared-work repository', () => {
  it('persists and reloads prepared work through a fresh repository instance', async () => {
    const { gateway, repository: first } = repository();
    const prepared = await first.prepare(candidate(), 'owner-1', '2026-09-15T00:00:00.000Z');
    const reloaded = await new SupabasePreparedWorkRepository(gateway).list('workspace-1');
    expect(prepared.alreadyPrepared).toBe(false);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toEqual(expect.objectContaining({ revActionId: prepared.artifact.revActionId, approvalState: 'pending', externalSend: false }));
    expect(gateway.state.actions[0].executionStatus).toBe('not_executed');
  });

  it('uses deterministic IDs and repairs retries without duplicate records', async () => {
    const { gateway, repository: service } = repository();
    const first = await service.prepare(candidate(), 'member-1');
    const replay = await service.prepare(candidate(), 'member-1');
    expect(replay.alreadyPrepared).toBe(true);
    expect(replay.artifact.id).toBe(first.artifact.id);
    expect(gateway.state.actions).toHaveLength(1);
    expect(gateway.state.approvals).toHaveLength(1);
    expect(gateway.state.memories).toHaveLength(1);
  });

  it.each(['owner-1', 'admin-1'] as const)('allows %s edit and approval', async (actorUserId) => {
    const { gateway, repository: service } = repository();
    const artifact = (await service.prepare(candidate(), actorUserId)).artifact;
    const edited = await service.edit('workspace-1', artifact.id, actorUserId, 'Reviewed subject', 'Reviewed message');
    const approved = await service.decide('workspace-1', artifact.id, actorUserId, 'approved');
    expect(edited.subject).toBe('Reviewed subject');
    expect(approved.approvalState).toBe('approved_not_sent');
    expect(gateway.state.actions[0]).toEqual(expect.objectContaining({ status: 'approved', executionStatus: 'not_executed' }));
    expect(gateway.state.actions[0].executedAt).toBeUndefined();
  });

  it('allows members to prepare but not edit or authorize', async () => {
    const { repository: service } = repository();
    const artifact = (await service.prepare(candidate(), 'member-1')).artifact;
    await expect(service.edit('workspace-1', artifact.id, 'member-1', 'Changed', 'Changed')).rejects.toThrow(/Owner or admin/);
    await expect(service.decide('workspace-1', artifact.id, 'member-1', 'approved')).rejects.toThrow(/Owner or admin/);
  });

  it('keeps viewers read-only', async () => {
    const { gateway, repository: ownerService } = repository();
    await ownerService.prepare(candidate(), 'owner-1');
    const viewerService = new SupabasePreparedWorkRepository(gateway);
    expect(await viewerService.list('workspace-1')).toHaveLength(1);
    await expect(viewerService.prepare(candidate({ id: 'viewer-write' }), 'viewer-1')).rejects.toThrow(/not authorised/);
  });

  it('denies cross-tenant candidate references and reads', async () => {
    const { repository: service } = repository();
    await expect(service.prepare(candidate({ opportunityId: 'opportunity-3', contactId: 'contact-3' }), 'owner-1')).rejects.toThrow(/active workspace/);
    expect(await service.list('workspace-2')).toHaveLength(0);
  });

  it('rejects stale approval atomically after a concurrent material edit', async () => {
    const { gateway, repository: service } = repository();
    const artifact = (await service.prepare(candidate(), 'owner-1')).artifact;
    gateway.mutateBeforeDecision = true;
    await expect(service.decide('workspace-1', artifact.id, 'owner-1', 'approved')).rejects.toThrow(/stale approval/);
    expect(gateway.state.approvals[0].decision).toBeUndefined();
    expect(gateway.state.actions[0].executionStatus).toBe('not_executed');
  });

  it('does not invoke a provider or network during repository orchestration', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { gateway, repository: service } = repository();
    await service.prepare(candidate(), 'owner-1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(gateway.providerInvocations).toBe(0);
    fetchSpy.mockRestore();
  });
});
