import React from 'react';
import { WorkspaceService } from '@/services/workspaceService';
import { Lead } from '@/types';

interface CustomersModuleProps {
  workspaceId: string;
}

export const CustomersModule: React.FC<CustomersModuleProps> = ({ workspaceId }) => {
  const workspaceData = WorkspaceService.getWorkspaceData(workspaceId);
  const leads = (workspaceData.leads || []) as Lead[];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'customer':
        return 'bg-green-100 text-green-800';
      case 'lead':
        return 'bg-blue-100 text-blue-800';
      case 'prospect':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-neutral-100 text-neutral-800';
    }
  };

  const getScoreColor = (score?: number) => {
    if (!score) return 'text-neutral-500';
    if (score >= 90) return 'text-green-600 font-bold';
    if (score >= 75) return 'text-blue-600 font-bold';
    return 'text-yellow-600';
  };

  const customerCount = leads.filter((l) => l.status === 'customer').length;
  const leadCount = leads.filter((l) => l.status === 'lead').length;
  const prospectCount = leads.filter((l) => l.status === 'prospect').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="card p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{customerCount}</div>
          <div className="text-sm text-neutral-600">Customers</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{leadCount}</div>
          <div className="text-sm text-neutral-600">Active Leads</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-3xl font-bold text-yellow-600">{prospectCount}</div>
          <div className="text-sm text-neutral-600">Prospects</div>
        </div>
      </div>

      {/* Leads Table */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-200">
          <h2 className="text-xl font-bold text-neutral-900">All Contacts</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-neutral-50 border-b border-neutral-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-neutral-600 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-neutral-600 uppercase">Company</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-neutral-600 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-neutral-600 uppercase">Value</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-neutral-600 uppercase">Score</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-neutral-600 uppercase">Last Contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-neutral-900">{lead.name}</td>
                  <td className="px-6 py-4 text-sm text-neutral-600">{lead.company || '-'}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(lead.status)}`}>
                      {lead.status.charAt(0).toUpperCase() + lead.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-neutral-600">
                    {lead.estimatedValue ? `$${lead.estimatedValue.toLocaleString()}` : '-'}
                  </td>
                  <td className={`px-6 py-4 text-sm font-semibold ${getScoreColor(lead.revScore)}`}>
                    {lead.revScore ? `${lead.revScore}%` : '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-neutral-600">
                    {lead.lastInteraction
                      ? new Date(lead.lastInteraction).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-6 card p-4 bg-neutral-50">
        <p className="text-sm text-neutral-600">
          <strong>REV Score:</strong> AI-generated confidence score (0-100%) that this contact is a strong opportunity.
          Higher scores indicate better product-market fit and engagement signals.
        </p>
      </div>
    </div>
  );
};
