import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OwnerControlCentre } from '@/components/HomeDashboard';
import { createMockDataProvider } from '@/data/mockProvider';
import { seedData } from '@/data/seedFixtures';
import {
  buildOwnerControlCentre,
  buildUnavailableOwnerControlCentre,
} from '@/services/ownerControlCentreService';

describe('Phase 4A Owner Control Centre UI', () => {
  it('shows the eight owner-facing sections and delegates approval review to REV', () => {
    const model = buildOwnerControlCentre({
      provider: createMockDataProvider(structuredClone(seedData)),
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      now: new Date('2026-09-14T00:00:00.000Z').getTime(),
    });
    const markup = renderToStaticMarkup(<OwnerControlCentre model={model} displayName="Mike" />);

    for (const heading of [
      'TODAY',
      'REV IS WORKING ON',
      'NEEDS YOUR APPROVAL',
      'READY / BLOCKED',
      'MONEY REV FOUND',
      'RECENT RESULTS',
      'COST / USAGE',
      'SYSTEM STATUS',
    ]) {
      expect(markup).toContain(`>${heading}</h2>`);
    }
    expect(markup).toContain('href="#rev"');
    expect(markup).toContain('Potential recovery evidence, not money won.');
    expect(markup).toContain('Approval means approved, not executed.');
    expect(markup).not.toMatch(/<button[^>]*>[^<]*Execute/i);
    expect(markup).toContain('Demo workspace data');
  });

  it('renders truthful live unavailable states without mock customer data', () => {
    const markup = renderToStaticMarkup(<OwnerControlCentre model={buildUnavailableOwnerControlCentre('live-workspace')} displayName="Owner" />);
    expect(markup).toContain('Live priorities are not available until operational repositories are connected.');
    expect(markup).toContain('Live recovery and revenue values are not available yet.');
    expect(markup).toContain('Live cost and usage data is not available yet.');
    expect(markup).toContain('Real execution is disabled. No action can run from this screen.');
    expect(markup).not.toMatch(/Sarah Chen|Webb Logistics/);
    expect(markup).not.toMatch(/<button[^>]*>[^<]*Execute/i);
    expect(markup).toContain('Live operational data unavailable');
    expect(markup.match(/class="rev-dashboard-metric-value">Unavailable<\/p>/g)).toHaveLength(4);
    expect(markup).not.toContain('Demo workspace data');
  });

  it('derives summary cards from the existing read model, including truthful zero counts', () => {
    const model = {
      ...buildUnavailableOwnerControlCentre('workspace'),
      mode: 'mock' as const,
      working: [{ id: 'work', title: 'Proposed work', detail: 'Awaiting review' }],
      approvals: [],
      readiness: [
        { id: 'ready', title: 'Internal plan', detail: 'Dry run only', state: 'ready_for_dry_run' as const, executionEnabled: false as const },
        { id: 'blocked', title: 'Blocked plan', detail: 'Provider unavailable', state: 'blocked' as const, executionEnabled: false as const },
      ],
      results: [],
    };
    const markup = renderToStaticMarkup(<OwnerControlCentre model={model} />);
    expect(markup.match(/class="rev-dashboard-metric-value">1<\/p>/g)).toHaveLength(2);
    expect(markup.match(/class="rev-dashboard-metric-value">0<\/p>/g)).toHaveLength(2);
    expect(markup).toContain('Internal dry run only');
    expect(markup).toContain('A decision, not execution');
  });
});