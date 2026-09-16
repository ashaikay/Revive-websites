import { TrustedActorContext, TrustedDryRunEnvelope, TrustedExecutionRequest } from '@/domain/execution';
import { DataProvider } from '@/domain/repositories';
import { recordAudit } from './auditService';
import { PLATFORM_EXECUTION_ENABLED } from './executionPolicyService';
import { TrustedExecutionBoundaryService } from './trustedExecutionBoundaryService';

export interface ControlledDryRunResult {
  requestId: string;
  workspaceId: string;
  actionId: string;
  status: 'dry_run_nothing_sent';
  displayStatus: 'DRY RUN — NOTHING SENT';
  externalSend: false;
  providerInvoked: false;
  providerCost: 0;
  executionEnabled: false;
  replayed: boolean;
  envelope: TrustedDryRunEnvelope;
}

export class ControlledExecutionRequestService {
  constructor(
    private readonly boundary: TrustedExecutionBoundaryService,
    private readonly provider: DataProvider,
  ) {}

  requestDryRun(request: TrustedExecutionRequest, actor: TrustedActorContext): ControlledDryRunResult {
    const envelope = this.boundary.prepareDryRun(request, actor);
    if (envelope.plan.status !== 'ready_for_dry_run') {
      throw new Error(`Execution request blocked: ${envelope.plan.reasons.join(' ')}`);
    }
    if (envelope.plan.capability !== 'PREPARE_FOLLOW_UP') throw new Error('Only prepared follow-up dry runs are supported in Phase 4F.');
    if (PLATFORM_EXECUTION_ENABLED || envelope.executionEnabled) throw new Error('Platform execution must remain disabled.');
    if (envelope.plan.externalCommunication) throw new Error('External communication is prohibited in Phase 4F.');
    if (envelope.providerInvoked || envelope.plan.externalProvider) throw new Error('Provider invocation is prohibited in Phase 4F.');
    if (envelope.plan.estimatedExternalCost !== 0) throw new Error('Phase 4F dry runs must have zero provider cost.');

    const result: ControlledDryRunResult = {
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      actionId: request.actionId,
      status: 'dry_run_nothing_sent',
      displayStatus: 'DRY RUN — NOTHING SENT',
      externalSend: false,
      providerInvoked: false,
      providerCost: 0,
      executionEnabled: false,
      replayed: envelope.idempotency.replayed,
      envelope,
    };

    if (!envelope.idempotency.replayed) {
      const metadata = {
        requestId: request.requestId,
        approvalId: envelope.approvalId,
        approvalFingerprint: envelope.approvalFingerprint,
        approvalFingerprintValid: envelope.approvalFingerprintValid,
        capability: envelope.plan.capability,
        policyDecision: envelope.plan.decision,
        executionEnabled: false,
        providerInvoked: false,
        providerCost: 0,
        externalSend: false,
      };
      recordAudit(this.provider, {
        workspaceId: request.workspaceId,
        actorUserId: actor.actorUserId,
        actorType: 'user',
        action: 'execution_request.dry_run_requested',
        resourceType: 'rev_action',
        resourceId: request.actionId,
        metadata,
      });
      recordAudit(this.provider, {
        workspaceId: request.workspaceId,
        actorUserId: actor.actorUserId,
        actorType: 'user',
        action: 'execution_request.dry_run_completed',
        resourceType: 'rev_action',
        resourceId: request.actionId,
        metadata: { ...metadata, result: result.displayStatus },
      });
    }

    return result;
  }
}