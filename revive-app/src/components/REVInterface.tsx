import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/hooks/useAppStore';
import { WorkspaceService } from '@/services/workspaceService';
import { GoalService } from '@/services/goalService';
import { REVActionService } from '@/services/revActionService';
import { ApprovalService } from '@/services/approvalService';
import { AIService } from '@/services/aiService';
import { capabilityForAction, createDryRunPlan } from '@/services/executionPolicyService';
import { analyzeRecovery } from '@/services/recoveryService';
import { FollowUpPreparationService } from '@/services/followUpPreparationService';
import { ControlledDryRunResult, ControlledExecutionRequestService } from '@/services/controlledExecutionRequestService';
import { TrustedExecutionBoundaryService } from '@/services/trustedExecutionBoundaryService';
import { dataProviderMode } from '@/data/provider';
import { ActionStatus, ApprovalDecision, ContactRecord, GoalRecord, REVActionRecord } from '@/domain/models';
import { PreparedFollowUpArtifact } from '@/domain/preparedWork';
import { LivePreparedWorkContext, SupabasePreparedWorkRepository } from '@/data/supabasePreparedWorkRepository';
import { requestLiveEmailExecution, type LiveEmailExecutionResult } from '@/services/liveEmailExecutionClient';

interface REVInterfaceProps {
  workspaceId: string;
}

const SPECIALIST_SKILLS = [
  'Outreach',
  'Lead Research',
  'Follow-Up',
  'Marketing',
  'Reviews',
  'Bid Writer',
  'Grant Writer',
  'Website',
  'Customer Reactivation',
  'Scheduling',
  'Business Research',
];

const WORK_QUEUE_LABEL: Record<ActionStatus, string> = {
  proposed: 'Planned',
  awaiting_approval: 'Waiting for approval',
  approved: 'Approved â€” not executed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed',
  failed: 'Blocked',
};

const WORK_QUEUE_TONE: Record<ActionStatus, string> = {
  proposed: 'badge-neutral',
  awaiting_approval: 'badge-warning',
  approved: 'badge-success',
  rejected: 'badge-danger',
  cancelled: 'badge-neutral',
  completed: 'badge-success',
  failed: 'badge-danger',
};

export function qualityGateLabel(action: REVActionRecord): string {
  if (!action.rationale) return 'Needs evidence';
  if (action.status === 'awaiting_approval') return 'Ready for approval';
  if (action.status === 'proposed') return 'Draft';
  return 'Checked';
}

export function userFacingRationale(rationale: string | undefined): string {
  if (!rationale) return 'EVIDENCE REQUIRED';
  return rationale.replace(/^prepared-follow-up:[^|]+\s*\|\s*/, '');
}

function revStatus(actions: REVActionRecord[], pendingApprovalCount: number): 'Ready' | 'Working' | 'Waiting for approval' {
  if (pendingApprovalCount > 0) return 'Waiting for approval';
  if (actions.some((action) => action.status === 'proposed' || action.status === 'awaiting_approval')) return 'Working';
  return 'Ready';
}

interface PreparedFollowUpReviewProps {
  artifact: PreparedFollowUpArtifact;
  canReview: boolean;
  onRefreshContext?: () => void;
  onEdit: (subject: string, draftMessage: string) => void;
  onApprove: () => void;
  onReject: () => void;
  canRequestExecution?: boolean;
  executionMode?: 'dry_run' | 'live';
  onRequestExecution?: () => void;
  executionResult?: ControlledDryRunResult;
  liveExecutionResult?: LiveEmailExecutionResult;
  executionError?: string;
}

export const PreparedFollowUpReview: React.FC<PreparedFollowUpReviewProps> = ({
  artifact, canReview, onRefreshContext, onEdit, onApprove, onReject, canRequestExecution = false, executionMode = 'dry_run',
  onRequestExecution, executionResult, liveExecutionResult, executionError,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [subject, setSubject] = useState(artifact.subject ?? '');
  const [draftMessage, setDraftMessage] = useState(artifact.draftMessage);
  const pending = artifact.approvalState === 'pending';

  return (
    <article className="card border-2 border-primary-200 overflow-hidden">
      <header className="bg-primary-50 px-5 py-4 border-b border-primary-100">
        <p className="text-xs font-semibold text-primary-700">REV PREPARED THIS FOR YOU</p>
        <div className="flex flex-wrap items-start justify-between gap-2 mt-1">
          <h3 className="font-semibold text-neutral-900">{artifact.subject}</h3>
          <span className={pending ? 'badge-warning' : artifact.approvalState === 'approved_not_sent' ? 'badge-success' : 'badge-danger'}>
            {pending ? 'DRAFT â€” REVIEW REQUIRED' : artifact.approvalState === 'approved_not_sent' ? 'APPROVED â€” NOT SENT' : 'REJECTED â€” NOT SENT'}
          </span>
        </div>
      </header>
      <div className="p-5 grid gap-5">
        <div className="grid sm:grid-cols-2 gap-3 text-sm text-neutral-700">
          <p><strong>Recovery reason:</strong> {artifact.recoveryReason}</p>
          <p><strong>Objective:</strong> {artifact.objective}</p>
          <p><strong>Suggested channel:</strong> {artifact.suggestedChannel.replace('_', ' ')}</p>
          <p><strong>External effect:</strong> None. Â£0 cost.</p>
        </div>

        {isEditing ? (
          <div className="grid gap-3">
            <label className="text-sm font-medium text-neutral-800" htmlFor={`prepared-subject-${artifact.id}`}>Subject</label>
            <input id={`prepared-subject-${artifact.id}`} className="input-field" value={subject} onChange={(event) => setSubject(event.target.value)} />
            <label className="text-sm font-medium text-neutral-800" htmlFor={`prepared-draft-${artifact.id}`}>Draft</label>
            <textarea id={`prepared-draft-${artifact.id}`} className="input-field min-h-48 resize-y" value={draftMessage} onChange={(event) => setDraftMessage(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary text-sm" type="button" onClick={() => { onEdit(subject, draftMessage); setIsEditing(false); }}>Save draft</button>
              <button className="btn-ghost text-sm" type="button" onClick={() => setIsEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xs font-semibold text-neutral-500">DRAFT</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">{artifact.draftMessage}</p>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-neutral-500">EVIDENCE USED</p>
          <ul className="mt-2 grid gap-1 text-sm text-neutral-700">
            {artifact.evidenceContext.map((evidence, index) => <li key={`${evidence.source}-${index}`}>{evidence.summary} <span className="text-neutral-500">({evidence.source})</span></li>)}
          </ul>
        </div>

        {artifact.missingInformation.length > 0 && (
          <div className="border-l-4 border-amber-400 pl-3">
            <p className="text-xs font-semibold text-amber-800">MISSING INFORMATION</p>
            {artifact.missingInformation.map((item) => <p key={item} className="text-sm text-amber-900 mt-1">{item}</p>)}
          </div>
        )}

        {pending && canReview && !isEditing && (
          <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-4">
            <button className="btn-secondary text-sm" type="button" onClick={onRefreshContext}>Refresh context</button>
            <button className="btn-secondary text-sm" type="button" onClick={() => setIsEditing(true)}>Edit</button>
            <button className="btn-primary text-sm" type="button" onClick={onApprove}>Approve</button>
            <button className="btn-ghost text-sm" type="button" onClick={onReject}>Reject</button>
          </div>
        )}
        {pending && !canReview && <p className="text-sm text-amber-800">Owner or admin review is required.</p>}
        {artifact.approvalState === 'approved_not_sent' && canRequestExecution && onRequestExecution && (
          <div className="border-t border-neutral-200 pt-4">
            <p className="text-sm font-medium text-neutral-900">
              {executionMode === 'live'
                ? 'LIVE EMAIL SEND - this will send the approved email to the contact.'
                : 'Phase 4F is dry-run only. Nothing will be sent.'}
            </p>
            <button
              className="btn-secondary text-sm mt-3"
              type="button"
              onClick={() => {
                if (executionMode === 'live' &&
                    !window.confirm('Send this approved email now? This will contact the recipient through Microsoft Graph.')) {
                  return;
                }
                onRequestExecution();
              }}
            >
              {executionMode === 'live' ? 'SEND APPROVED EMAIL' : 'REQUEST EXECUTION'}
            </button>
          </div>
        )}
        {executionResult && (
          <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
            <strong>{executionResult.displayStatus}</strong>
            <p className="mt-1">Provider calls: 0 Â· Cost: Â£0 Â· External effect: none</p>
          </div>
        )}
        {liveExecutionResult && (
          <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
            <strong>
              {liveExecutionResult.acceptedByProvider
                ? 'ACCEPTED BY PROVIDER ? DELIVERY NOT CONFIRMED'
                : liveExecutionResult.displayStatus ?? liveExecutionResult.status}
            </strong>
            {liveExecutionResult.acceptedByProvider && (
              <p className="mt-1">Microsoft accepted the send request. This does not confirm delivery.</p>
            )}
            {liveExecutionResult.providerInvoked === 'unknown' && (
              <p className="mt-1">Provider outcome is unknown. Do not retry automatically.</p>
            )}
          </div>
        )}
        {executionError && <p className="text-sm text-red-700" role="alert">{executionError}</p>}
        <p className="text-xs text-neutral-500">
          {executionMode === 'live'
            ? 'Preparation and approval alone do not send this draft. Sending requires the explicit live-send action above.'
            : 'Preparation and approval do not send this draft. No provider is invoked.'}
        </p>
      </div>
    </article>
  );
};

export const REVInterface: React.FC<REVInterfaceProps> = ({ workspaceId }) => {
  if (dataProviderMode === 'supabase') return <LiveRevWorkspace workspaceId={workspaceId} />;
  return <MockRevWorkspace workspaceId={workspaceId} />;
};

const MockRevWorkspace: React.FC<REVInterfaceProps> = ({ workspaceId }) => {
  const { currentUser } = useAppStore();
  const provider = useMemo(() => WorkspaceService.getDataProvider(), []);
  const goalService = useMemo(() => new GoalService(provider), [provider]);
  const actionService = useMemo(() => new REVActionService(provider), [provider]);
  const approvalService = useMemo(() => new ApprovalService(provider), [provider]);
  const followUpService = useMemo(() => new FollowUpPreparationService(provider), [provider]);
  const executionRequestService = useMemo(() => new ControlledExecutionRequestService(
    new TrustedExecutionBoundaryService(provider, {
      resolve: () => ({
        workspaceExecutionEnabled: true,
        providerConfigured: false,
        estimatedExternalCost: 0,
        countryCode: 'GB',
        jurisdiction: 'GB',
        autonomyMode: 'always_ask',
        audienceSafety: 'allowed',
        usagePlan: 'free',
      }),
    }),
    provider,
  ), [provider]);
  const [, setVersion] = useState(0);
  const [editingApprovalId, setEditingApprovalId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'rev'; content: string }[]>([
    { role: 'rev', content: "Hi, I'm REV. Tell me what you'd like your business to achieve and I'll get to work." },
  ]);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [executionResults, setExecutionResults] = useState<Record<string, ControlledDryRunResult>>({});
  const [executionErrors, setExecutionErrors] = useState<Record<string, string>>({});

  const goals: GoalRecord[] = goalService.list(workspaceId);
  const actions: REVActionRecord[] = actionService.list(workspaceId);
  const approvals = approvalService.list(workspaceId);
  const contacts: ContactRecord[] = provider.contacts.list(workspaceId);
  const contactName = (contactId?: string) => contacts.find((contact) => contact.id === contactId)?.name;

  const primaryGoal = goals.find((goal) => goal.status === 'active') ?? goals[0];
  const membership = provider.workspaces.getMembership(workspaceId, currentUser.id);
  const canReviewPreparedWork = membership?.role === 'owner' || membership?.role === 'admin';
  const recovery = analyzeRecovery({
    workspaceId,
    goal: primaryGoal,
    profile: provider.business.getProfile(workspaceId),
    services: provider.business.listServices(workspaceId),
    contacts,
    opportunities: provider.opportunities.list(workspaceId),
    discoveryCandidates: [],
  });
  const preparedFollowUps = followUpService.list(workspaceId);
  const pendingApprovals = approvals.filter((approval) => !approval.decision);
  const actionForApproval = (revActionId: string) => actions.find((action) => action.id === revActionId);
  const genericPendingApprovals = pendingApprovals.filter((approval) => actionForApproval(approval.revActionId)?.actionType !== 'prepare_follow_up');
  const completedActions = actions.filter((action) => action.status === 'completed');
  const outcomeActions = completedActions.filter((action) => action.outcomeSummary);
  const status = revStatus(actions, pendingApprovals.length);
  const executionPlans = actions.slice(0, 3).map((action) => createDryRunPlan({
    action,
    capability: capabilityForAction(action),
    actorUserId: currentUser.id,
    workspaceId,
    approvalId: approvals.find((approval) => approval.revActionId === action.id)?.id,
    approvalState: action.status === 'approved' ? 'approved' : action.status === 'rejected' ? 'rejected' : 'pending',
    audienceSafety: 'allowed',
    estimatedExternalCost: 0,
    providerConfigured: false,
    countryCode: 'GB',
  }));

  const handleDecide = (approvalId: string, decision: ApprovalDecision, notes?: string) => {
    approvalService.decide(workspaceId, approvalId, decision, currentUser.id, notes);
    setEditingApprovalId(null);
    setEditNotes('');
    setVersion((v) => v + 1);
  };

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    const response = await AIService.reason(input, { workspaceData: { goals, actions }, context: 'REV Workspace' });
    setMessages((prev) => [...prev, { role: 'rev', content: response.content }]);
    setInput('');
  };

  const handlePrepareFollowUp = (candidateId: string) => {
    const candidate = recovery.candidates.find((item) => item.id === candidateId);
    if (!candidate) return;
    try {
      followUpService.prepare(candidate, currentUser.id);
      setPreparationError(null);
      setVersion((version) => version + 1);
    } catch (error) {
      setPreparationError(error instanceof Error ? error.message : 'REV could not prepare this follow-up.');
    }
  };

  const handleEditPrepared = (artifact: PreparedFollowUpArtifact, subject: string, draftMessage: string) => {
    followUpService.edit(workspaceId, artifact.id, currentUser.id, subject, draftMessage);
    setVersion((version) => version + 1);
  };

  const handleDecidePrepared = (artifact: PreparedFollowUpArtifact, decision: 'approved' | 'rejected') => {
    followUpService.decide(workspaceId, artifact.id, currentUser.id, decision);
    setVersion((version) => version + 1);
  };

  const handleRequestExecution = (artifact: PreparedFollowUpArtifact) => {
    try {
      const result = executionRequestService.requestDryRun(
        { requestId: `phase4f-${artifact.revActionId}`, workspaceId, actionId: artifact.revActionId },
        { actorUserId: currentUser.id },
      );
      setExecutionResults((current) => ({ ...current, [artifact.id]: result }));
      setExecutionErrors((current) => ({ ...current, [artifact.id]: '' }));
    } catch (error) {
      setExecutionErrors((current) => ({
        ...current,
        [artifact.id]: error instanceof Error ? error.message : 'The dry-run request was blocked.',
      }));
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
      {/* Header / status */}
      <section className="order-0 rev-motion-in card p-6 bg-gradient-to-r from-primary-600 to-primary-700 text-white">
        <p className="text-xs font-semibold tracking-[0.2em] text-primary-100">REV</p>
        <h1 className="text-3xl font-bold mt-1">Your AI Growth Employee</h1>
        <span className="badge bg-white/15 text-white mt-4 inline-block" role="status">
          {status}
        </span>
      </section>

      {/* Current objective */}
      <section aria-labelledby="objective-heading" className="order-1 sm:order-1 rev-motion-in">
        <h2 id="objective-heading" className="text-xl font-bold text-neutral-900 mb-4">
          CURRENT OBJECTIVE
        </h2>
        {primaryGoal ? (
          <div className="card p-6">
            <p className="text-neutral-900 font-medium">{primaryGoal.objective}</p>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex-1 w-full bg-neutral-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary-600 h-full transition-all"
                  style={{ width: `${Math.min(100, (primaryGoal.currentValue / primaryGoal.targetValue) * 100)}%` }}
                />
              </div>
              <span className="text-sm font-semibold text-neutral-900 whitespace-nowrap">
                {primaryGoal.currentValue} / {primaryGoal.targetValue}
              </span>
            </div>
          </div>
        ) : (
          <div className="card p-6 text-center text-neutral-600">No active objective has been set for this workspace yet.</div>
        )}
      </section>

      {/* Conversation / task input */}
      <section aria-labelledby="input-heading" className="order-2 sm:order-2 rev-motion-in">
        <h2 id="input-heading" className="text-xl font-bold text-neutral-900 mb-4">
          TALK TO REV
        </h2>
        <div className="card overflow-hidden">
          <div className="max-h-72 overflow-y-auto p-4 bg-neutral-50 space-y-3">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-sm px-4 py-2 rounded-lg text-sm ${
                    message.role === 'user' ? 'bg-primary-600 text-white' : 'bg-white border border-neutral-200 text-neutral-900'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={handleSendMessage} className="flex gap-2 p-4 border-t border-neutral-200">
            <label className="sr-only" htmlFor="rev-task-input">
              Tell REV what you want to achieve
            </label>
            <input
              id="rev-task-input"
              className="input-field flex-1"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="e.g. Follow up my old quotes"
            />
            <button className="btn-primary" type="submit">
              Ask REV
            </button>
          </form>
          <p className="px-4 pb-4 text-xs text-neutral-500">Demo reasoning only â€” REV AI execution is not connected yet.</p>
        </div>
      </section>

      <section aria-labelledby="recovery-heading" className="order-3 sm:order-3 rev-motion-in">
        <h2 id="recovery-heading" className="text-xl font-bold text-neutral-900 mb-4">RECOVERY OPPORTUNITIES</h2>
        {recovery.candidates.length > 0 ? (
          <div className="grid gap-3">
            {recovery.candidates.map((candidate) => {
              const alreadyPrepared = preparedFollowUps.some((artifact) => artifact.recoveryCandidateId === candidate.id);
              const opportunity = candidate.opportunityId ? provider.opportunities.get(workspaceId, candidate.opportunityId) : undefined;
              const candidateContact = provider.contacts.get(workspaceId, candidate.contactId ?? opportunity?.contactId ?? '');
              const suppressed = candidateContact?.doNotContact === true;
              return (
                <article key={candidate.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-neutral-900">{opportunity?.title ?? candidateContact?.name ?? 'Recovery opportunity'}</p>
                      <p className="text-sm text-neutral-600 mt-1">{candidate.reason}</p>
                      <p className="text-xs text-neutral-500 mt-2">Evidence: {candidate.evidence.map((item) => item.summary).join(' ')}</p>
                    </div>
                    <button
                      className="btn-secondary text-sm"
                      type="button"
                      disabled={alreadyPrepared || suppressed || candidate.safety !== 'allowed'}
                      onClick={() => handlePrepareFollowUp(candidate.id)}
                    >
                      {alreadyPrepared ? 'Draft prepared' : suppressed ? 'Suppressed' : 'Prepare follow-up'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="card p-6 text-center text-neutral-600">No evidence-supported recovery opportunities are available.</div>
        )}
        {preparationError && <p role="alert" className="text-sm text-red-700 mt-3">{preparationError}</p>}
      </section>

      {preparedFollowUps.length > 0 && (
        <section aria-labelledby="prepared-heading" className="order-3 sm:order-4 rev-motion-in">
          <h2 id="prepared-heading" className="text-xl font-bold text-neutral-900 mb-4">PREPARED FOLLOW-UPS</h2>
          <div className="grid gap-4">
            {preparedFollowUps.map((artifact) => (
              <PreparedFollowUpReview
                key={artifact.id}
                artifact={artifact}
                canReview={canReviewPreparedWork}
                onEdit={(subject, draftMessage) => handleEditPrepared(artifact, subject, draftMessage)}
                onApprove={() => handleDecidePrepared(artifact, 'approved')}
                onReject={() => handleDecidePrepared(artifact, 'rejected')}
                canRequestExecution={canReviewPreparedWork && artifact.approvalState === 'approved_not_sent'}
                onRequestExecution={() => handleRequestExecution(artifact)}
                executionResult={executionResults[artifact.id]}
                executionError={executionErrors[artifact.id]}
              />
            ))}
          </div>
        </section>
      )}

      {/* What REV is working on */}
      <section aria-labelledby="work-heading" className="order-4 sm:order-3 rev-motion-in">
        <h2 id="work-heading" className="text-xl font-bold text-neutral-900 mb-4">
          WHAT REV IS WORKING ON
        </h2>
        {actions.length > 0 ? (
          <ul className="card divide-y divide-neutral-100">
            {actions.map((action) => (
              <li key={action.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-neutral-900">{action.title}</p>
                  <span className={WORK_QUEUE_TONE[action.status]}>{WORK_QUEUE_LABEL[action.status]}</span>
                </div>
                <p className="text-sm text-neutral-600 mt-1">{action.description}</p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs text-neutral-500">
                  {contactName(action.contactId) && <span>Related to {contactName(action.contactId)}</span>}
                  <span>Quality gate: {qualityGateLabel(action)}</span>
                  {!action.rationale && <span className="font-semibold text-amber-700">EVIDENCE REQUIRED</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card p-6 text-center text-neutral-600">REV has no work in progress for this workspace.</div>
        )}
      </section>

      {/* Recommendations */}
      <section aria-labelledby="recommendations-heading" className="order-5 sm:order-4 rev-motion-in">
        <h2 id="recommendations-heading" className="text-xl font-bold text-neutral-900 mb-4">
          RECOMMENDATIONS
        </h2>
        {actions.filter((action) => action.rationale).length > 0 ? (
          <div className="space-y-3">
            {actions
              .filter((action) => action.rationale)
              .map((action) => (
                <div key={action.id} className="card p-4 bg-primary-50 border-primary-200">
                  <p className="text-primary-900 font-medium">{action.title}</p>
                  <p className="text-sm text-primary-800 mt-1">{userFacingRationale(action.rationale)}</p>
                </div>
              ))}
          </div>
        ) : (
          <div className="card p-6 text-center text-neutral-600">REV has no recommendations right now.</div>
        )}
      </section>

      <section aria-labelledby="readiness-heading" className="order-6 sm:order-6 rev-motion-in">
        <h2 id="readiness-heading" className="text-xl font-bold text-neutral-900 mb-4">EXECUTION READINESS</h2>
        {executionPlans.length > 0 ? (
          <div className="space-y-3">
            {executionPlans.map((plan) => (
              <div key={plan.actionId} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-neutral-900">{actions.find((action) => action.id === plan.actionId)?.title}</p>
                    <p className="text-sm text-neutral-600">Capability: {plan.capability}</p>
                  </div>
                  <span className={plan.status === 'ready_for_dry_run' ? 'badge-success' : 'badge-warning'}>
                    {plan.status === 'ready_for_dry_run' ? 'Ready for dry run' : 'Execution blocked'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3 mt-3 text-xs text-neutral-600">
                  <span>External effect: {plan.externalCommunication ? 'External communication' : 'None'}</span>
                  <span>Expected cost: {plan.estimatedExternalCost === 0 ? 'Â£0' : `Â£${plan.estimatedExternalCost}`}</span>
                  <span>Execution: Disabled</span>
                </div>
                <button className="btn-secondary text-sm mt-3" type="button" onClick={() => setExpandedPlanId(expandedPlanId === plan.actionId ? null : plan.actionId)}>
                  {expandedPlanId === plan.actionId ? 'Hide execution plan' : 'View execution plan'}
                </button>
                {expandedPlanId === plan.actionId && (
                  <div className="mt-3 border-t border-neutral-200 pt-3 text-sm text-neutral-700">
                    <p><strong>Policy:</strong> {plan.decision.replace(/_/g, ' ')}</p>
                    {plan.reasons.map((reason) => <p key={reason} className="mt-1">{reason}</p>)}
                    {plan.expectedSideEffects.map((effect) => <p key={effect} className="mt-1"><strong>Side effect:</strong> {effect}</p>)}
                    <p className="mt-1 font-semibold text-neutral-900">No Execute action is available in this phase.</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-6 text-center text-neutral-600">Execution planning is unavailable until REV has a proposed action.</div>
        )}
      </section>

      {/* Approvals */}
      <section aria-labelledby="approvals-heading" className="order-3 sm:order-7 rev-motion-in">
        <h2 id="approvals-heading" className="text-xl font-bold text-neutral-900 mb-4">
          {genericPendingApprovals.length > 0 ? 'REV NEEDS YOUR APPROVAL' : 'APPROVALS'}
        </h2>
        {genericPendingApprovals.length > 0 ? (
          <div className="card p-6 border-2 border-yellow-200 bg-yellow-50 space-y-4">
            {genericPendingApprovals.map((approval) => {
              const action = actionForApproval(approval.revActionId);
              if (!action) return null;
              return (
                <div key={approval.id} className="bg-white p-4 rounded-lg border border-yellow-100">
                  <h3 className="font-semibold text-neutral-900">{action.title}</h3>
                  <p className="text-sm text-neutral-600 mt-1">{userFacingRationale(action.rationale)}</p>
                  <div className="mt-3 grid gap-1 text-xs text-neutral-600">
                    <p><strong>What REV will do:</strong> {action.description}</p>
                    <p><strong>External effect:</strong> NONE. Execution is disabled in this phase.</p>
                    <p><strong>Approval:</strong> {action.status === 'approved' ? 'APPROVED â€” NOT EXECUTED' : 'Required before any future execution.'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {!approval.decision && <button className="btn-primary text-sm" type="button" onClick={() => handleDecide(approval.id, 'approved')}>
                      Approve
                    </button>}
                    {!approval.decision && <button
                      className="btn-secondary text-sm"
                      type="button"
                      onClick={() => setEditingApprovalId(editingApprovalId === approval.id ? null : approval.id)}
                    >
                      Edit
                    </button>}
                    {!approval.decision && <button className="btn-ghost text-sm" type="button" onClick={() => handleDecide(approval.id, 'rejected')}>
                      Reject
                    </button>}
                  </div>
                  {editingApprovalId === approval.id && (
                    <div className="mt-3 flex gap-2">
                      <label className="sr-only" htmlFor={`edit-notes-${approval.id}`}>
                        Edit notes
                      </label>
                      <input
                        id={`edit-notes-${approval.id}`}
                        className="input-field flex-1"
                        placeholder="Add an edit note before approving"
                        value={editNotes}
                        onChange={(event) => setEditNotes(event.target.value)}
                      />
                      <button className="btn-primary text-sm" type="button" onClick={() => handleDecide(approval.id, 'edited', editNotes)}>
                        Save & approve
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-neutral-500 mt-2">Approved actions remain APPROVED â€” NOT EXECUTED.</p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card p-6 bg-neutral-100 text-center text-neutral-600">No pending approvals. REV is ready for new tasks.</div>
        )}
      </section>

      {/* Recently completed */}
      <section aria-labelledby="completed-heading" className="order-6 sm:order-6 rev-motion-in">
        <h2 id="completed-heading" className="text-xl font-bold text-neutral-900 mb-4">
          RECENTLY COMPLETED
        </h2>
        {completedActions.length > 0 ? (
          <ul className="card divide-y divide-neutral-100">
            {completedActions.map((action) => (
              <li key={action.id} className="p-4">
                <p className="font-medium text-neutral-900">{action.title}</p>
                {action.outcomeSummary && <p className="text-sm text-neutral-600 mt-1">{action.outcomeSummary}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="card p-6 text-center text-neutral-600">No completed REV work yet.</div>
        )}
      </section>

      {/* Outcomes / impact */}
      <section aria-labelledby="outcomes-heading" className="order-7 sm:order-7 rev-motion-in">
        <h2 id="outcomes-heading" className="text-xl font-bold text-neutral-900 mb-4">
          OUTCOMES
        </h2>
        {outcomeActions.length > 0 ? (
          <ul className="card divide-y divide-neutral-100">
            {outcomeActions.map((action) => (
              <li key={action.id} className="p-4 text-neutral-700">
                {action.outcomeSummary}
              </li>
            ))}
          </ul>
        ) : (
          <div className="card p-6 text-center text-neutral-600">
            No measurable outcomes recorded yet. Full revenue intelligence arrives in Phase 3D.
          </div>
        )}
      </section>

      {/* Specialist skills */}
      <section aria-labelledby="skills-heading" className="order-8 sm:order-8 rev-motion-in">
        <h2 id="skills-heading" className="text-xl font-bold text-neutral-900 mb-4">
          REV SKILLS
        </h2>
        <div className="flex flex-wrap gap-2">
          {SPECIALIST_SKILLS.map((skill) => (
            <span key={skill} className="badge-neutral">
              {skill}
            </span>
          ))}
        </div>
        <p className="text-xs text-neutral-500 mt-2">Shown as available REV capabilities; not all skills are operational yet.</p>
      </section>
    </div>
  );
};

const LiveRevWorkspace: React.FC<REVInterfaceProps> = ({ workspaceId }) => {
  const { currentUser } = useAppStore();
  const repository = useMemo(() => new SupabasePreparedWorkRepository(), []);
  const [context, setContext] = useState<LivePreparedWorkContext | null>(null);
  const [preparedFollowUps, setPreparedFollowUps] = useState<PreparedFollowUpArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveExecutionErrors, setLiveExecutionErrors] = useState<Record<string, string>>({});
  const [liveExecutionResults, setLiveExecutionResults] = useState<Record<string, LiveEmailExecutionResult>>({});

  const handleLiveExecutionRequest = async (artifact: PreparedFollowUpArtifact) => {
    setBusyId(artifact.id);
    setLiveExecutionErrors((current) => ({ ...current, [artifact.id]: '' }));

    try {
      const result = await requestLiveEmailExecution(workspaceId, artifact.revActionId);
      setLiveExecutionResults((current) => ({ ...current, [artifact.id]: result }));
      await reload();
    } catch (executionError) {
      setLiveExecutionErrors((current) => ({
        ...current,
        [artifact.id]: executionError instanceof Error
          ? executionError.message
          : 'Trusted email execution request failed.',
      }));
    } finally {
      setBusyId(null);
    }
  };

  const reload = async () => {
    const [nextContext, nextPrepared] = await Promise.all([
      repository.loadContext(workspaceId, currentUser.id),
      repository.list(workspaceId),
    ]);
    setContext(nextContext);
    setPreparedFollowUps(nextPrepared);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([repository.loadContext(workspaceId, currentUser.id), repository.list(workspaceId)])
      .then(([nextContext, nextPrepared]) => {
        if (!active) return;
        setContext(nextContext);
        setPreparedFollowUps(nextPrepared);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Live REV work could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentUser.id, repository, workspaceId]);

  const primaryGoal = context?.goals.find((goal) => goal.status === 'active') ?? context?.goals[0];
  const recovery = context ? analyzeRecovery({
    workspaceId,
    goal: primaryGoal,
    profile: context.profile,
    services: context.services,
    contacts: context.contacts,
    opportunities: context.opportunities,
    discoveryCandidates: [],
  }) : undefined;
  const canReview = context?.membership?.role === 'owner' || context?.membership?.role === 'admin';

  const runChange = async (id: string, operation: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await operation();
      await reload();
      setError(null);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Live prepared work could not be updated.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
      <section className="rev-motion-in card p-6 bg-gradient-to-r from-primary-600 to-primary-700 text-white">
        <p className="text-xs font-semibold tracking-[0.2em] text-primary-100">REV LIVE</p>
        <h1 className="text-3xl font-bold mt-1">Your AI Growth Employee</h1>
        <span className="badge bg-white/15 text-white mt-4 inline-block" role="status">
          {loading ? 'Loading workspace' : preparedFollowUps.some((item) => item.approvalState === 'pending') ? 'Waiting for approval' : 'Ready'}
        </span>
      </section>

      {error && <div role="alert" className="card p-4 border border-red-200 bg-red-50 text-sm text-red-800">{error}</div>}
      {loading && <LiveEmptySection title="PREPARED WORK" message="Loading workspace-scoped REV workâ€¦" />}

      {!loading && context && (
        <>
          <section aria-labelledby="live-objective-heading" className="rev-motion-in">
            <h2 id="live-objective-heading" className="text-xl font-bold text-neutral-900 mb-4">CURRENT OBJECTIVE</h2>
            <div className="card p-5 text-neutral-700">{primaryGoal?.objective ?? 'No active objective is recorded for this workspace.'}</div>
          </section>

          <section aria-labelledby="live-recovery-heading" className="rev-motion-in">
            <h2 id="live-recovery-heading" className="text-xl font-bold text-neutral-900 mb-4">RECOVERY OPPORTUNITIES</h2>
            {recovery && recovery.candidates.length > 0 ? (
              <div className="grid gap-3">
                {recovery.candidates.map((candidate) => {
                  const opportunity = candidate.opportunityId ? context.opportunities.find((item) => item.id === candidate.opportunityId) : undefined;
                  const contact = context.contacts.find((item) => item.id === (candidate.contactId ?? opportunity?.contactId));
                  const alreadyPrepared = preparedFollowUps.some((item) => item.recoveryCandidateId === candidate.id);
                  const unavailable = alreadyPrepared || contact?.doNotContact || candidate.safety !== 'allowed' || busyId === candidate.id;
                  return (
                    <article key={candidate.id} className="card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-neutral-900">{opportunity?.title ?? contact?.name ?? 'Recovery opportunity'}</p>
                          <p className="text-sm text-neutral-600 mt-1">{candidate.reason}</p>
                          <p className="text-xs text-neutral-500 mt-2">Evidence: {candidate.evidence.map((item) => item.summary).join(' ')}</p>
                        </div>
                        {context.membership?.role !== 'viewer' && (
                          <button className="btn-secondary text-sm" type="button" disabled={unavailable} onClick={() => runChange(candidate.id, () => repository.prepare(candidate, currentUser.id))}>
                            {alreadyPrepared ? 'Draft prepared' : contact?.doNotContact ? 'Suppressed' : busyId === candidate.id ? 'Preparingâ€¦' : 'Prepare follow-up'}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : <div className="card p-6 text-center text-neutral-600">No evidence-supported recovery opportunities are available.</div>}
          </section>

          <section aria-labelledby="live-prepared-heading" className="rev-motion-in">
            <h2 id="live-prepared-heading" className="text-xl font-bold text-neutral-900 mb-4">PREPARED FOLLOW-UPS</h2>
            {preparedFollowUps.length > 0 ? (
              <div className="grid gap-4">
                {preparedFollowUps.map((artifact) => (
                  <PreparedFollowUpReview
                    key={artifact.id}
                    artifact={artifact}
                    canReview={canReview && busyId !== artifact.id}
                    onRefreshContext={() => runChange(artifact.id, () => repository.refreshContext(workspaceId, artifact.id, currentUser.id))}
                    onEdit={(subject, draftMessage) => runChange(artifact.id, () => repository.edit(workspaceId, artifact.id, currentUser.id, subject, draftMessage))}
                    onApprove={() => runChange(artifact.id, () => repository.decide(workspaceId, artifact.id, currentUser.id, 'approved'))}
                    onReject={() => runChange(artifact.id, () => repository.decide(workspaceId, artifact.id, currentUser.id, 'rejected'))}
                    canRequestExecution={canReview && artifact.approvalState === 'approved_not_sent'}
                    executionMode="live"
                    onRequestExecution={() => handleLiveExecutionRequest(artifact)}
                    liveExecutionResult={liveExecutionResults[artifact.id]}
                    executionError={liveExecutionErrors[artifact.id]}
                  />
                ))}
              </div>
            ) : <div className="card p-6 text-center text-neutral-600">No prepared follow-up work is recorded for this workspace.</div>}
          </section>

          <section className="card p-4 text-sm text-neutral-700">
            <strong>Live execution is controlled.</strong> Only an approved follow-up can be sent, and sending requires explicit confirmation.
          </section>
        </>
      )}
    </div>
  );
};

const LiveEmptySection: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <section className="rev-motion-in">
    <h2 className="text-xl font-bold text-neutral-900 mb-4">{title}</h2>
    <div className="card p-6 text-center text-neutral-600">{message}</div>
  </section>
);

