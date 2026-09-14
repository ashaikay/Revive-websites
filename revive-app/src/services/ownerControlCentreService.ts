import { REVActionRecord } from '@/domain/models';
import { DataProvider } from '@/domain/repositories';
import { CostGovernor } from './discoveryFoundationService';
import { buildCommercialPlan } from './commercialIntelligenceService';
import {
  PLATFORM_EXECUTION_ENABLED,
  capabilityForAction,
  createDryRunPlan,
  getCapability,
} from './executionPolicyService';
import { computeOpportunityRevenue } from './opportunityService';
import { analyzeRecovery } from './recoveryService';

export type ControlCentreMode = 'mock' | 'live';

export interface ControlCentreItem {
  id: string;
  title: string;
  detail: string;
}

export interface ControlCentreReadinessItem extends ControlCentreItem {
  state: 'ready_for_dry_run' | 'blocked';
  executionEnabled: false;
}

export interface ControlCentreMoney {
  available: boolean;
  potentialValue?: number;
  recoverableValue?: number;
  pipelineValue?: number;
  wonRevenue?: number;
  revRecovered?: number;
  revGenerated?: number;
  unknownPotentialValueCount: number;
}

export interface ControlCentreUsage {
  available: boolean;
  used?: number;
  allowance?: number;
  remaining?: number;
  message: string;
}

export interface OwnerControlCentreReadModel {
  workspaceId: string;
  mode: ControlCentreMode;
  today: ControlCentreItem[];
  working: ControlCentreItem[];
  approvals: ControlCentreItem[];
  readiness: ControlCentreReadinessItem[];
  money: ControlCentreMoney;
  results: ControlCentreItem[];
  usage: ControlCentreUsage;
  systemStatus: { label: string; value: string; safe: boolean }[];
}

export interface OwnerControlCentreInput {
  provider: DataProvider;
  workspaceId: string;
  actorUserId: string;
  now?: number;
  costGovernor?: CostGovernor;
  usagePlan?: 'free' | 'paid';
}

function systemStatus() {
  return [
    { label: 'REV execution', value: PLATFORM_EXECUTION_ENABLED ? 'Enabled' : 'Disabled', safe: !PLATFORM_EXECUTION_ENABLED },
    { label: 'Approval mode', value: 'Always ask', safe: true },
    { label: 'External communication', value: getCapability('SEND_EMAIL').enabled ? 'Enabled' : 'Disabled', safe: !getCapability('SEND_EMAIL').enabled },
    { label: 'Financial actions', value: getCapability('FINANCIAL_ACTION').enabled ? 'Enabled' : 'Disabled', safe: !getCapability('FINANCIAL_ACTION').enabled },
  ];
}

function readinessReason(decision: ReturnType<typeof createDryRunPlan>['decision'], reasons: string[]): string {
  const labels: Partial<Record<typeof decision, string>> = {
    eligible_for_dry_run: 'Ready for internal dry run only. Real execution is disabled.',
    requires_fresh_approval: 'Needs approval before readiness can be assessed.',
    requires_provider: 'The required provider is unavailable.',
    blocked_by_cost: 'The current cost limit does not allow this work.',
    not_supported: 'This jurisdiction is not currently supported.',
    requires_review: 'A safety or autonomy review is required.',
    requires_configuration: 'Required configuration is unavailable.',
  };
  return labels[decision] ?? reasons[0] ?? 'This capability is currently blocked.';
}

function latestActionTime(action: REVActionRecord): string {
  return action.executedAt ?? action.approvedAt ?? action.proposedAt;
}

export function buildOwnerControlCentre(input: OwnerControlCentreInput): OwnerControlCentreReadModel {
  const { provider, workspaceId, actorUserId } = input;
  const now = input.now ?? Date.now();
  const goals = provider.goals.list(workspaceId).filter((item) => item.workspaceId === workspaceId);
  const contacts = provider.contacts.list(workspaceId).filter((item) => item.workspaceId === workspaceId);
  const opportunities = provider.opportunities.list(workspaceId).filter((item) => item.workspaceId === workspaceId);
  const actions = provider.actions.list(workspaceId).filter((item) => item.workspaceId === workspaceId);
  const approvals = provider.approvals.list(workspaceId).filter((item) => item.workspaceId === workspaceId);
  const profile = provider.business.getProfile(workspaceId);
  const services = provider.business.listServices(workspaceId).filter((item) => item.workspaceId === workspaceId);
  const goal = goals.find((item) => item.status === 'active') ?? goals[0];
  const commercialContext = {
    workspaceId,
    goal,
    profile: profile?.workspaceId === workspaceId ? profile : undefined,
    services,
    contacts,
    opportunities,
    discoveryCandidates: [],
    now,
  };
  const commercialPlan = buildCommercialPlan(commercialContext);
  const recovery = analyzeRecovery(commercialContext);
  const revenue = computeOpportunityRevenue(opportunities, now);
  const pendingApprovals = approvals.filter((approval) => !approval.decision)
    .map((approval) => ({ approval, action: actions.find((action) => action.id === approval.revActionId) }))
    .filter((entry): entry is { approval: typeof approvals[number]; action: REVActionRecord } => Boolean(entry.action));

  const working = actions
    .filter((action) => action.status === 'proposed' || action.executionStatus === 'in_progress')
    .sort((left, right) => latestActionTime(right).localeCompare(latestActionTime(left)))
    .map((action) => ({
      id: action.id,
      title: action.title,
      detail: action.executionStatus === 'in_progress' ? 'REV is working on this now.' : 'Proposed work is being prepared for review.',
    }));

  const approvalItems = pendingApprovals.map(({ approval, action }) => ({
    id: approval.id,
    title: action.title,
    detail: action.rationale ?? 'REV needs your decision before this can progress.',
  }));

  const readiness = actions
    .filter((action) => ['proposed', 'awaiting_approval', 'approved'].includes(action.status))
    .map((action): ControlCentreReadinessItem => {
      const approval = approvals.find((item) => item.revActionId === action.id);
      const plan = createDryRunPlan({
        action,
        capability: capabilityForAction(action),
        actorUserId,
        workspaceId,
        approvalId: approval?.id,
        approvalState: approval?.decision === 'approved' || approval?.decision === 'edited'
          ? 'approved'
          : approval?.decision === 'rejected' ? 'rejected' : 'pending',
        audienceSafety: 'allowed',
        estimatedExternalCost: 0,
        providerConfigured: false,
        countryCode: 'GB',
        autonomyMode: 'always_ask',
      });
      return {
        id: action.id,
        title: action.title,
        detail: readinessReason(plan.decision, plan.reasons),
        state: plan.status === 'ready_for_dry_run' ? 'ready_for_dry_run' : 'blocked',
        executionEnabled: false,
      };
    });

  const results = actions
    .filter((action) => action.status === 'completed' || action.status === 'failed' || action.executionStatus === 'succeeded' || action.executionStatus === 'failed')
    .sort((left, right) => latestActionTime(right).localeCompare(latestActionTime(left)))
    .slice(0, 5)
    .map((action) => ({
      id: action.id,
      title: action.title,
      detail: action.outcomeSummary ?? (action.status === 'failed' || action.executionStatus === 'failed'
        ? 'This work failed. No commercial outcome has been recorded.'
        : 'Work completed. No commercial outcome has been recorded.'),
    }));

  const today: ControlCentreItem[] = [];
  if (approvalItems[0]) today.push({ ...approvalItems[0], id: `today-approval-${approvalItems[0].id}`, title: 'Your approval is needed' });
  const recommendation = commercialPlan.recommendations[0];
  if (recommendation) today.push({ id: `today-recommendation-${recommendation.id}`, title: recommendation.title, detail: recommendation.whatRevFound });
  if (results[0]) today.push({ ...results[0], id: `today-result-${results[0].id}`, title: `Recent result: ${results[0].title}` });
  const priorityOpportunity = [...opportunities]
    .filter((item) => !['won', 'lost'].includes(item.stage))
    .sort((left, right) => (right.estimatedValue ?? 0) - (left.estimatedValue ?? 0))[0];
  if (today.length < 3 && priorityOpportunity) {
    today.push({ id: `today-opportunity-${priorityOpportunity.id}`, title: priorityOpportunity.title, detail: 'Highest recorded open opportunity by potential value.' });
  }

  const usageBudget = input.costGovernor?.budget(workspaceId, input.usagePlan ?? 'free');

  return {
    workspaceId,
    mode: 'mock',
    today: today.slice(0, 3),
    working,
    approvals: approvalItems,
    readiness,
    money: {
      available: true,
      potentialValue: recovery.potentialValue,
      recoverableValue: revenue.recoverable,
      pipelineValue: revenue.pipeline,
      wonRevenue: revenue.won,
      revRecovered: revenue.revRecovered,
      revGenerated: revenue.revGenerated,
      unknownPotentialValueCount: recovery.unknownValueCount,
    },
    results,
    usage: usageBudget ? {
      available: true,
      used: usageBudget.used,
      allowance: usageBudget.allowance,
      remaining: usageBudget.remaining,
      message: 'Included research units only. Monetary spend is not tracked in this phase.',
    } : {
      available: false,
      message: 'No shared usage ledger is connected to the Control Centre yet.',
    },
    systemStatus: systemStatus(),
  };
}

export function buildUnavailableOwnerControlCentre(workspaceId: string): OwnerControlCentreReadModel {
  return {
    workspaceId,
    mode: 'live',
    today: [],
    working: [],
    approvals: [],
    readiness: [],
    money: { available: false, unknownPotentialValueCount: 0 },
    results: [],
    usage: { available: false, message: 'Live cost and usage data is not available yet.' },
    systemStatus: systemStatus(),
  };
}