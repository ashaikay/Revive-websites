import React from 'react';
import { useAppStore } from '@/hooks/useAppStore';
import { WorkspaceService } from '@/services/workspaceService';
import { Goal, Lead, REVAction } from '@/types';
import { dataProviderMode } from '@/data/provider';

interface HomeDashboardProps {
  workspaceId: string;
}

const currency = (value: number) =>
  value.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

const ACTIVITY_LABEL: Record<string, string> = {
  research: 'Researching opportunities',
  outreach: 'Preparing outreach',
  follow_up: 'Reviewing follow-ups',
  meeting_prep: 'Preparing for a meeting',
};

function activityHeadline(action: REVAction): string {
  if (action.status === 'completed') return `Completed: ${action.description}`;
  return ACTIVITY_LABEL[action.type] ?? action.description;
}

/** Revenue snapshot derived only from existing lead records; no figures are invented. */
export function computeRevenueSnapshot(leads: Lead[]) {
  const won = leads.filter((lead) => lead.status === 'customer');
  const pipeline = leads.filter((lead) => lead.status === 'lead' || lead.status === 'prospect');
  const staleCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const atRisk = pipeline.filter((lead) => (lead.lastInteraction?.getTime() ?? 0) < staleCutoff);
  const recoverable = leads.filter((lead) => lead.status === 'archived');
  const sum = (items: Lead[]) => items.reduce((total, lead) => total + (lead.estimatedValue ?? 0), 0);
  return {
    won: sum(won),
    pipeline: sum(pipeline),
    atRisk: sum(atRisk),
    recoverable: sum(recoverable),
  };
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({ workspaceId }) => {
  const { currentUser } = useAppStore();

  if (dataProviderMode === 'supabase') {
    return <LiveCommandCentre displayName={currentUser?.displayName} />;
  }

  const workspaceData = WorkspaceService.getWorkspaceData(workspaceId);
  const primaryGoal = workspaceData.goals?.[0] as Goal | undefined;
  const dailyBrief = workspaceData.dailyBrief;
  const pendingApprovals = workspaceData.approvals?.filter((a) => a.status === 'pending') || [];
  const recentActivity = [...(workspaceData.actions ?? [])].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const revenue = computeRevenueSnapshot(workspaceData.leads ?? []);
  const hour = new Date().getHours();
  const greetingWord = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Greeting */}
      <div className="rev-motion-in">
        <h1 className="text-4xl font-bold text-neutral-900">
          {greetingWord}, {currentUser.displayName}.
        </h1>
        <p className="text-neutral-600 mt-1">REV has been working while you were away.</p>
      </div>

      {/* Daily Business Brief */}
      {dailyBrief && (
        <section aria-labelledby="daily-brief-heading" className="rev-motion-in">
          <h2 id="daily-brief-heading" className="text-xl font-bold text-neutral-900 mb-4">
            DAILY BUSINESS BRIEF
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <BriefStat value={dailyBrief.hotLeads} label="hot leads" />
            <BriefStat value={dailyBrief.repliesNeeded} label="replies need attention" />
            <BriefStat value={dailyBrief.followUpsDue} label="follow-ups due" />
            <BriefStat value={dailyBrief.meetingsToday} label="meeting today" />
          </div>
          {dailyBrief.recommendation && (
            <div className="mt-4 card p-6 bg-gradient-to-br from-primary-50 to-primary-100 border-primary-200">
              <h3 className="text-lg font-bold text-primary-900 mb-2">REV RECOMMENDS</h3>
              <p className="text-primary-800">{dailyBrief.recommendation}</p>
            </div>
          )}
        </section>
      )}

      {/* Revenue / Growth summary */}
      <section aria-labelledby="revenue-heading" className="rev-motion-in">
        <h2 id="revenue-heading" className="text-xl font-bold text-neutral-900 mb-4">
          WHERE THE MONEY IS
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <RevenueStat label="WON REVENUE" value={revenue.won} tone="success" />
          <RevenueStat label="IN PIPELINE" value={revenue.pipeline} tone="neutral" />
          <RevenueStat label="AT RISK" value={revenue.atRisk} tone="danger" />
          <RevenueStat label="RECOVERABLE" value={revenue.recoverable} tone="warning" />
        </div>
      </section>

      {/* Attention / Approvals */}
      <section aria-labelledby="attention-heading" className="rev-motion-in">
        <h2 id="attention-heading" className="text-xl font-bold text-neutral-900 mb-4">
          {pendingApprovals.length > 0 ? 'REV NEEDS YOUR ATTENTION' : 'ALL CLEAR'}
        </h2>
        {pendingApprovals.length > 0 ? (
          <div className="card p-6 border-2 border-yellow-200 bg-yellow-50 space-y-4">
            {pendingApprovals.slice(0, 3).map((approval) => (
              <div key={approval.id} className="bg-white p-4 rounded-lg border border-yellow-100">
                <h3 className="font-semibold text-neutral-900 mb-2">{approval.description}</h3>
                <p className="text-sm text-neutral-600 mb-3">{approval.revReasoning}</p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary text-sm" type="button" aria-label={`Approve: ${approval.description}`}>
                    Approve
                  </button>
                  <button className="btn-secondary text-sm" type="button" aria-label={`Edit and approve: ${approval.description}`}>
                    Edit
                  </button>
                  <button className="btn-ghost text-sm" type="button" aria-label={`Reject: ${approval.description}`}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-6 bg-neutral-100 text-center text-neutral-600">
            No pending approvals. REV is ready for new tasks.
          </div>
        )}
      </section>

      {/* REV Activity */}
      <section aria-labelledby="activity-heading" className="rev-motion-in">
        <h2 id="activity-heading" className="text-xl font-bold text-neutral-900 mb-4">
          WHAT REV IS DOING
        </h2>
        {recentActivity.length > 0 ? (
          <ul className="card divide-y divide-neutral-100">
            {recentActivity.slice(0, 5).map((action) => (
              <li key={action.id} className="p-4 flex items-start gap-3">
                <span
                  className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                    action.status === 'completed' ? 'bg-green-500' : 'bg-primary-500'
                  }`}
                  aria-hidden="true"
                />
                <div>
                  <p className="text-neutral-900 font-medium">{activityHeadline(action)}</p>
                  {action.result && <p className="text-sm text-neutral-600 mt-1">{action.result}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card p-6 text-center text-neutral-600">REV has no recent activity to show yet.</div>
        )}
      </section>

      {/* Goal progress */}
      {primaryGoal && (
        <section aria-labelledby="goal-heading" className="rev-motion-in">
          <h2 id="goal-heading" className="text-xl font-bold text-neutral-900 mb-4">
            GOAL PROGRESS
          </h2>
          <div className="card p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-sm font-semibold text-neutral-500 uppercase tracking-wide">Primary goal</p>
                <p className="text-neutral-900 mt-1">{primaryGoal.objective}</p>
              </div>
              <span className="badge-success" role="status">
                On track
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="w-full bg-neutral-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-primary-600 h-full transition-all"
                    style={{ width: `${Math.min(100, (primaryGoal.currentProgress / primaryGoal.targetValue) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="text-sm font-semibold text-neutral-900 whitespace-nowrap">
                {primaryGoal.currentProgress} / {primaryGoal.targetValue}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

const BriefStat: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div className="card p-4 text-center">
    <div className="text-3xl font-bold text-primary-600">{value}</div>
    <div className="text-sm text-neutral-600">{label}</div>
  </div>
);

const RevenueStat: React.FC<{ label: string; value: number; tone: 'success' | 'neutral' | 'danger' | 'warning' }> = ({
  label,
  value,
  tone,
}) => {
  const toneClass =
    tone === 'success'
      ? 'text-green-700'
      : tone === 'danger'
        ? 'text-red-700'
        : tone === 'warning'
          ? 'text-amber-700'
          : 'text-neutral-900';
  return (
    <div className="card p-4">
      <div className={`text-2xl font-bold ${toneClass}`}>{value > 0 ? currency(value) : '—'}</div>
      <div className="text-sm text-neutral-600">{label}</div>
    </div>
  );
};

/**
 * Live (Supabase) mode HOME. Goals/approvals/activity/revenue repositories remain
 * mock-only per Phase 2D.2 scope, so this surface shows honest empty states rather
 * than fabricating live business performance.
 */
const LiveCommandCentre: React.FC<{ displayName?: string }> = ({ displayName }) => {
  const hour = new Date().getHours();
  const greetingWord = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="rev-motion-in">
        <h1 className="text-4xl font-bold text-neutral-900">
          {greetingWord}
          {displayName ? `, ${displayName}` : ''}.
        </h1>
        <p className="text-neutral-600 mt-1">
          Live workspace context is connected. Daily Brief, approvals, and activity are not yet available in live mode.
        </p>
      </div>

      <EmptyLiveSection title="DAILY BUSINESS BRIEF" message="The Daily Business Brief is not yet connected to live workspace data." />
      <EmptyLiveSection title="WHERE THE MONEY IS" message="Revenue intelligence is not yet connected to live workspace data." />
      <EmptyLiveSection title="REV NEEDS YOUR ATTENTION" message="Live approvals are not yet available in this mode." />
      <EmptyLiveSection title="WHAT REV IS DOING" message="REV activity is not yet available in live mode." />

      <p className="text-sm text-neutral-500">
        Visit BUSINESS to see this workspace&apos;s live Business Brain profile and services.
      </p>
    </div>
  );
};

const EmptyLiveSection: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <section className="rev-motion-in">
    <h2 className="text-xl font-bold text-neutral-900 mb-4">{title}</h2>
    <div className="card p-6 text-center text-neutral-600">{message}</div>
  </section>
);
