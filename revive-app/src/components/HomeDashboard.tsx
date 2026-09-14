import React from 'react';
import { dataProviderMode } from '@/data/provider';
import { useAppStore } from '@/hooks/useAppStore';
import { WorkspaceService } from '@/services/workspaceService';
import {
  OwnerControlCentreReadModel,
  buildOwnerControlCentre,
  buildUnavailableOwnerControlCentre,
} from '@/services/ownerControlCentreService';
import { Lead } from '@/types';

interface HomeDashboardProps {
  workspaceId: string;
}

const currency = (value: number) =>
  value.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

/** Preserved Phase 3B compatibility helper; Phase 4A HOME uses the Opportunity read model. */
export function computeRevenueSnapshot(leads: Lead[]) {
  const won = leads.filter((lead) => lead.status === 'customer');
  const pipeline = leads.filter((lead) => lead.status === 'lead' || lead.status === 'prospect');
  const staleCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const atRisk = pipeline.filter((lead) => (lead.lastInteraction?.getTime() ?? 0) < staleCutoff);
  const recoverable = leads.filter((lead) => lead.status === 'archived');
  const sum = (items: Lead[]) => items.reduce((total, lead) => total + (lead.estimatedValue ?? 0), 0);
  return { won: sum(won), pipeline: sum(pipeline), atRisk: sum(atRisk), recoverable: sum(recoverable) };
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({ workspaceId }) => {
  const { currentUser } = useAppStore();
  const model = dataProviderMode === 'supabase'
    ? buildUnavailableOwnerControlCentre(workspaceId)
    : buildOwnerControlCentre({
      provider: WorkspaceService.getDataProvider(),
      workspaceId,
      actorUserId: currentUser.id,
    });

  return <OwnerControlCentre model={model} displayName={currentUser.displayName} />;
};

interface OwnerControlCentreProps {
  model: OwnerControlCentreReadModel;
  displayName?: string;
}

export const OwnerControlCentre: React.FC<OwnerControlCentreProps> = ({ model, displayName }) => {
  const hour = new Date().getHours();
  const greetingWord = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const liveUnavailable = model.mode === 'live';

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-7 sm:py-10 space-y-9">
      <header className="rev-motion-in border-b border-neutral-200 pb-6">
        <p className="text-xs font-bold text-primary-700 uppercase tracking-widest">Owner Control Centre</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-neutral-950 mt-2">
          {greetingWord}{displayName ? `, ${displayName}` : ''}.
        </h1>
        <p className="text-neutral-600 mt-2 max-w-2xl">
          What REV is doing today, what needs you, where value may be waiting, and what happened.
        </p>
      </header>

      <section aria-labelledby="today-heading" className="rev-motion-in bg-neutral-950 text-white p-5 sm:p-6 rounded-lg">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 id="today-heading" className="text-lg font-bold">TODAY</h2>
          <span className="text-xs text-neutral-300">Top priorities only</span>
        </div>
        {model.today.length > 0 ? (
          <ul className="divide-y divide-neutral-700">
            {model.today.map((item) => (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                <p className="font-semibold">{item.title}</p>
                <p className="text-sm text-neutral-300 mt-1">{item.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-300">
            {liveUnavailable ? 'Live priorities are not available until operational repositories are connected.' : 'No supported priority items need attention today.'}
          </p>
        )}
      </section>

      <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.85fr)] gap-9 lg:gap-12 items-start">
        <div className="space-y-9 min-w-0">
          <ControlSection title="REV IS WORKING ON" id="working-heading">
            <ItemList items={model.working} empty={liveUnavailable ? 'Live REV work is not available yet.' : 'REV has no proposed or in-progress work right now.'} />
          </ControlSection>

          <ControlSection title="NEEDS YOUR APPROVAL" id="approval-heading">
            {model.approvals.length > 0 ? (
              <div className="border-l-4 border-amber-400 bg-amber-50 px-4 py-4 rounded-r-lg">
                <ItemList items={model.approvals.slice(0, 3)} />
                <a href="#rev" className="btn-primary text-sm inline-flex mt-4">Review in REV</a>
                <p className="text-xs text-amber-900 mt-3">Approval means approved, not executed.</p>
              </div>
            ) : (
              <EmptyState text={liveUnavailable ? 'Live approvals are not available yet.' : 'Nothing is waiting for your approval.'} />
            )}
          </ControlSection>

          <ControlSection title="READY / BLOCKED" id="readiness-heading">
            {model.readiness.length > 0 ? (
              <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
                {model.readiness.map((item) => (
                  <li key={item.id} className="py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-5">
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-900 break-words">{item.title}</p>
                      <p className="text-sm text-neutral-600 mt-1">{item.detail}</p>
                    </div>
                    <span className={item.state === 'ready_for_dry_run' ? 'badge-success whitespace-nowrap' : 'badge-warning whitespace-nowrap'}>
                      {item.state === 'ready_for_dry_run' ? 'Ready for dry run' : 'Blocked'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState text={liveUnavailable ? 'Live readiness cannot be assessed until actions and approvals are connected.' : 'There are no active actions to assess.'} />
            )}
            <p className="text-xs text-neutral-500 mt-3">Real execution is disabled. No action can run from this screen.</p>
          </ControlSection>

          <ControlSection title="RECENT RESULTS" id="results-heading">
            <ItemList items={model.results} empty={liveUnavailable ? 'Live outcomes are not available yet.' : 'No completed or failed REV work is recorded yet.'} />
            <p className="text-xs text-neutral-500 mt-3">Completing work does not create or attribute revenue.</p>
          </ControlSection>
        </div>

        <aside className="space-y-9 min-w-0">
          <ControlSection title="MONEY REV FOUND" id="money-heading">
            {model.money.available ? (
              <div className="border-y border-amber-200 py-5">
                <p className="text-3xl font-bold text-amber-800">{money(model.money.potentialValue)}</p>
                <p className="font-semibold text-neutral-900 mt-1">Potential value</p>
                <p className="text-sm text-neutral-600 mt-1">Potential recovery evidence, not money won.</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-4 mt-5 pt-5 border-t border-neutral-200">
                  <MoneyLine label="Recoverable value" value={model.money.recoverableValue} />
                  <MoneyLine label="Pipeline value" value={model.money.pipelineValue} />
                  <MoneyLine label="Won revenue" value={model.money.wonRevenue} />
                  <MoneyLine label="REV recovered" value={model.money.revRecovered} />
                  <MoneyLine label="REV generated" value={model.money.revGenerated} />
                  <div>
                    <dt className="text-xs text-neutral-500">Unknown values</dt>
                    <dd className="font-semibold text-neutral-900 mt-1">{model.money.unknownPotentialValueCount}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <EmptyState text="Live recovery and revenue values are not available yet." />
            )}
          </ControlSection>

          <ControlSection title="COST / USAGE" id="usage-heading">
            {model.usage.available ? (
              <div className="border-y border-neutral-200 py-4">
                <p className="text-2xl font-bold text-neutral-950">{model.usage.used} / {model.usage.allowance}</p>
                <p className="text-sm text-neutral-600 mt-1">Included research units used</p>
                <p className="text-xs text-neutral-500 mt-3">{model.usage.message}</p>
              </div>
            ) : (
              <EmptyState text={model.usage.message} />
            )}
          </ControlSection>

          <ControlSection title="SYSTEM STATUS" id="status-heading">
            <dl className="divide-y divide-neutral-200 border-y border-neutral-200">
              {model.systemStatus.map((item) => (
                <div key={item.label} className="py-3 flex items-center justify-between gap-4">
                  <dt className="text-sm text-neutral-600">{item.label}</dt>
                  <dd className="text-sm font-semibold text-neutral-900 flex items-center gap-2 text-right">
                    <span className={`h-2 w-2 rounded-full flex-none ${item.safe ? 'bg-green-500' : 'bg-amber-500'}`} aria-hidden="true" />
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </ControlSection>
        </aside>
      </div>
    </main>
  );
};

const ControlSection: React.FC<{ title: string; id: string; children: React.ReactNode }> = ({ title, id, children }) => (
  <section aria-labelledby={id} className="rev-motion-in">
    <h2 id={id} className="text-lg font-bold text-neutral-950 mb-3">{title}</h2>
    {children}
  </section>
);

const ItemList: React.FC<{ items: OwnerControlCentreReadModel['today']; empty?: string }> = ({ items, empty }) => items.length > 0 ? (
  <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
    {items.map((item) => (
      <li key={item.id} className="py-4">
        <p className="font-semibold text-neutral-900 break-words">{item.title}</p>
        <p className="text-sm text-neutral-600 mt-1">{item.detail}</p>
      </li>
    ))}
  </ul>
) : <EmptyState text={empty ?? 'Nothing to show.'} />;

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="border-y border-neutral-200 py-4 text-sm text-neutral-500">{text}</div>
);

const MoneyLine: React.FC<{ label: string; value?: number }> = ({ label, value }) => (
  <div>
    <dt className="text-xs text-neutral-500">{label}</dt>
    <dd className="font-semibold text-neutral-900 mt-1">{money(value)}</dd>
  </div>
);

function money(value: number | undefined): string {
  return typeof value === 'number' ? currency(value) : 'Unavailable';
}