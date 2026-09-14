import { describe, expect, it } from 'vitest';
import { computeRevenueSnapshot } from '@/components/HomeDashboard';
import { Lead } from '@/types';

function lead(overrides: Partial<Lead>): Lead {
  return {
    id: 'lead-x',
    workspaceId: 'workspace-1',
    name: 'Test Lead',
    status: 'lead',
    estimatedValue: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Phase 3B HOME revenue snapshot', () => {
  it('sums won revenue only from customer-status leads', () => {
    const leads = [lead({ status: 'customer', estimatedValue: 25000 }), lead({ status: 'lead', estimatedValue: 15000 })];
    expect(computeRevenueSnapshot(leads).won).toBe(25000);
  });

  it('sums pipeline revenue from lead and prospect statuses only', () => {
    const leads = [
      lead({ status: 'lead', estimatedValue: 15000 }),
      lead({ status: 'prospect', estimatedValue: 8000 }),
      lead({ status: 'customer', estimatedValue: 25000 }),
    ];
    expect(computeRevenueSnapshot(leads).pipeline).toBe(23000);
  });

  it('flags pipeline leads with no interaction in 14+ days as at risk', () => {
    const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const fresh = new Date();
    const leads = [
      lead({ status: 'lead', estimatedValue: 15000, lastInteraction: stale }),
      lead({ status: 'lead', estimatedValue: 5000, lastInteraction: fresh }),
    ];
    expect(computeRevenueSnapshot(leads).atRisk).toBe(15000);
  });

  it('sums recoverable revenue only from archived leads', () => {
    const leads = [lead({ status: 'archived', estimatedValue: 6000 }), lead({ status: 'customer', estimatedValue: 25000 })];
    expect(computeRevenueSnapshot(leads).recoverable).toBe(6000);
  });

  it('never fabricates a figure for an empty lead list', () => {
    expect(computeRevenueSnapshot([])).toEqual({ won: 0, pipeline: 0, atRisk: 0, recoverable: 0 });
  });
});
