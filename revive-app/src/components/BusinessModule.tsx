import React from 'react';
import { WorkspaceService } from '@/services/workspaceService';
import { BusinessMemory } from '@/types';
import { dataProviderMode } from '@/data/provider';
import { loadBusinessBrain } from '@/services/businessBrainService';

interface BusinessModuleProps {
  workspaceId: string;
}

export const BusinessModule: React.FC<BusinessModuleProps> = ({ workspaceId }) => {
  const [liveState, setLiveState] = React.useState<{ loading: boolean; error: boolean; profile?: Awaited<ReturnType<typeof loadBusinessBrain>>['profile']; services: Awaited<ReturnType<typeof loadBusinessBrain>>['services'] }>({ loading: dataProviderMode === 'supabase', error: false, services: [] });

  React.useEffect(() => {
    if (dataProviderMode !== 'supabase') return;
    let mounted = true;
    setLiveState({ loading: true, error: false, services: [] });
    void loadBusinessBrain(workspaceId)
      .then((brain) => mounted && setLiveState({ loading: false, error: false, profile: brain.profile, services: brain.services }))
      .catch(() => mounted && setLiveState({ loading: false, error: true, services: [] }));
    return () => { mounted = false; };
  }, [workspaceId]);

  if (dataProviderMode === 'supabase') {
    if (liveState.loading) return <div className="max-w-7xl mx-auto px-4 py-12 text-neutral-600">Loading Business Brain...</div>;
    if (liveState.error) return <div className="max-w-7xl mx-auto px-4 py-12 text-red-700">Business Brain could not be loaded for this workspace.</div>;
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-neutral-900 mb-2">Business Brain</h1>
          <p className="text-neutral-600">Read-only live workspace context.</p>
        </div>
        {liveState.profile ? (
          <div className="card p-6 mb-8 bg-gradient-to-r from-primary-50 to-primary-100 border-primary-200">
            <h2 className="text-2xl font-bold text-primary-900 mb-2">{liveState.profile.businessName}</h2>
            <p className="text-primary-800 mb-4">{liveState.profile.description}</p>
            <p className="text-sm text-primary-700"><strong>Brand Voice:</strong> {liveState.profile.brandVoice || 'Not set'}</p>
          </div>
        ) : <div className="card p-6 mb-8 text-neutral-600">No business profile has been created for this workspace.</div>}
        <section className="card p-6">
          <h2 className="text-xl font-bold text-neutral-900 mb-4">Services</h2>
          {liveState.services.length === 0 ? <p className="text-neutral-600">No active services found.</p> : <ul className="space-y-2">{liveState.services.map((service) => <li key={service.id} className="text-neutral-700">{service.name}</li>)}</ul>}
        </section>
      </div>
    );
  }

  const workspaceData = WorkspaceService.getWorkspaceData(workspaceId);
  const businessMemory = workspaceData.businessMemory as BusinessMemory | undefined;
  const businessProfile = workspaceData.businessProfile;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-neutral-900 mb-2">Business Brain</h1>
        <p className="text-neutral-600">
          This is how REV learns about your business. The more detail you provide, the better REV's recommendations.
        </p>
      </div>

      {businessProfile && (
        <div className="card p-6 mb-8 bg-gradient-to-r from-primary-50 to-primary-100 border-primary-200">
          <h2 className="text-2xl font-bold text-primary-900 mb-2">{businessProfile.businessName}</h2>
          <p className="text-primary-800 mb-4">{businessProfile.description}</p>
          <div>
            <p className="text-sm text-primary-700">
              <strong>Brand Voice:</strong> {businessProfile.brandVoice}
            </p>
          </div>
        </div>
      )}

      {businessMemory && (
        <div className="space-y-6">
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">📋</span>
              <h3 className="text-xl font-bold text-neutral-900">Services</h3>
            </div>
            <div className="space-y-2">
              {businessMemory.services.map((service, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-primary-600 mt-1">✓</span>
                  <span className="text-neutral-700">{service}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">👥</span>
              <h3 className="text-xl font-bold text-neutral-900">Target Customers</h3>
            </div>
            <p className="text-neutral-700">{businessMemory.targetCustomers}</p>
          </div>

          {businessMemory.locations && businessMemory.locations.length > 0 && (
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">📍</span>
                <h3 className="text-xl font-bold text-neutral-900">Locations</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {businessMemory.locations.map((location, idx) => (
                  <div key={idx} className="bg-neutral-50 p-3 rounded-lg text-neutral-700">
                    {location}
                  </div>
                ))}
              </div>
            </div>
          )}

          {businessMemory.openingHours && (
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">⏰</span>
                <h3 className="text-xl font-bold text-neutral-900">Opening Hours</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(businessMemory.openingHours).map(([day, hours]) => (
                  <div key={day} className="flex justify-between">
                    <span className="font-medium text-neutral-700">{day}</span>
                    <span className="text-neutral-600">{hours}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {businessMemory.faqs && businessMemory.faqs.length > 0 && (
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">❓</span>
                <h3 className="text-xl font-bold text-neutral-900">FAQs</h3>
              </div>
              <div className="space-y-4">
                {businessMemory.faqs.map((faq, idx) => (
                  <div key={idx} className="border-l-2 border-primary-200 pl-4">
                    <p className="font-semibold text-neutral-900 mb-1">{faq.question}</p>
                    <p className="text-neutral-600 text-sm">{faq.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🔗</span>
              <h3 className="text-xl font-bold text-neutral-900">Integrations</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(businessMemory.integrations || {}).map(([key, connected]) => (
                <div key={key} className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg">
                  <span className="font-medium text-neutral-700 capitalize">{key.replace('_', ' ')}</span>
                  <span className={`text-sm font-semibold ${connected ? 'text-green-600' : 'text-neutral-400'}`}>
                    {connected ? '✓ Connected' : '○ Available'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🔐</span>
              <h3 className="text-xl font-bold text-neutral-900">REV Permissions</h3>
            </div>
            <div className="space-y-3">
              {Object.entries(businessMemory.revPermissions || {}).map(([key, enabled]) => (
                <div key={key} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={enabled}
                    readOnly
                    className="w-4 h-4"
                  />
                  <label className="text-neutral-700 capitalize">{key.replace('_', ' ')}</label>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 text-center">
        <button className="btn-primary">Update Business Info</button>
      </div>
    </div>
  );
};
