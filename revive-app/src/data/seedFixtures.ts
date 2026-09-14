import {
  ApprovalRecord,
  AuditLogRecord,
  BusinessMemoryEventRecord,
  BusinessProfileRecord,
  BusinessServiceRecord,
  ContactRecord,
  GoalRecord,
  OpportunityRecord,
  REVActionRecord,
  WorkspaceMemberRecord,
  WorkspaceRecord,
} from '@/domain/models';

export interface SeedData {
  workspaces: WorkspaceRecord[];
  members: WorkspaceMemberRecord[];
  profiles: BusinessProfileRecord[];
  services: BusinessServiceRecord[];
  goals: GoalRecord[];
  contacts: ContactRecord[];
  actions: REVActionRecord[];
  opportunities: OpportunityRecord[];
  approvals: ApprovalRecord[];
  memoryEvents: BusinessMemoryEventRecord[];
  auditLogs: AuditLogRecord[];
}

const createdAt = '2024-12-20T09:00:00.000Z';

export const seedData: SeedData = {
  workspaces: [
    { id: 'workspace-1', name: 'Revive', slug: 'revive', status: 'active', createdAt, updatedAt: createdAt },
    { id: 'workspace-2', name: 'Family Legacy', slug: 'family-legacy', status: 'active', createdAt, updatedAt: createdAt },
  ],
  members: [
    { workspaceId: 'workspace-1', userId: 'user-1', role: 'owner', status: 'active', joinedAt: createdAt },
    { workspaceId: 'workspace-2', userId: 'user-1', role: 'owner', status: 'active', joinedAt: createdAt },
  ],
  profiles: [
    {
      workspaceId: 'workspace-1', businessName: 'Revive', description: 'AI platform for small business growth',
      website: 'https://revive.example', industry: 'Technology', targetCustomers: 'Small business owners and service providers',
      serviceAreas: ['Remote-first'], openingHours: { Mon: '9am-6pm EST', Tue: '9am-6pm EST', Wed: '9am-6pm EST', Thu: '9am-6pm EST', Fri: '9am-6pm EST' },
      differentiators: ['Goal-driven AI employee', 'Approval-first execution'], brandVoice: 'Professional, innovative, trustworthy', createdAt, updatedAt: createdAt,
    },
    {
      workspaceId: 'workspace-2', businessName: 'Family Legacy Planning', description: 'Estate planning and family business succession',
      website: 'https://familylegacy.example', industry: 'Professional Services', targetCustomers: 'High-net-worth families and family business owners',
      serviceAreas: ['New York', 'Remote consultation'], openingHours: { Mon: '10am-5pm EST', Tue: '10am-5pm EST', Wed: '10am-5pm EST', Thu: '10am-5pm EST', Fri: '10am-4pm EST' },
      differentiators: ['Family-focused planning', 'Long-term continuity'], brandVoice: 'Caring, detailed, trustworthy', createdAt, updatedAt: createdAt,
    },
  ],
  services: [
    { id: 'service-1', workspaceId: 'workspace-1', name: 'AI business growth platform', description: 'Goal-driven support for small businesses', priceInformation: 'Demo pricing only', active: true },
    { id: 'service-2', workspaceId: 'workspace-2', name: 'Estate planning', description: 'Comprehensive estate planning', priceInformation: 'Consultation required', active: true },
  ],
  goals: [
    { id: 'goal-1', workspaceId: 'workspace-1', title: 'Book 5 new sales meetings', objective: 'Book 5 new sales meetings this month', metric: 'meetings_booked', targetValue: 5, currentValue: 2, startDate: '2024-12-01', targetDate: '2024-12-31', priority: 'high', status: 'active', createdAt, updatedAt: createdAt },
    { id: 'goal-2', workspaceId: 'workspace-2', title: 'Complete 3 estate plans', objective: 'Complete 3 estate plans this quarter', metric: 'plans_completed', targetValue: 3, currentValue: 1, startDate: '2024-10-01', targetDate: '2024-12-31', priority: 'high', status: 'active', createdAt, updatedAt: createdAt },
  ],
  contacts: [
    { id: 'contact-1', workspaceId: 'workspace-1', lifecycle: 'lead', name: 'Sarah Chen', company: 'TechStartup Inc', email: 'sarah@techstartup.io', source: 'website', estimatedValue: 15000, score: 92, lastInteractionAt: '2024-12-18T12:00:00.000Z', nextActionAt: '2024-12-21T12:00:00.000Z', ownerUserId: 'user-1', attribution: 'rev_assisted', createdAt, updatedAt: createdAt },
    { id: 'contact-2', workspaceId: 'workspace-1', lifecycle: 'prospect', name: 'James Rodriguez', company: 'EcomPro Solutions', email: 'james@ecommerce.co', source: 'referral', estimatedValue: 8000, score: 78, lastInteractionAt: '2024-12-15T12:00:00.000Z', ownerUserId: 'user-1', attribution: 'unattributed', doNotContact: true, suppressionReason: 'unsubscribed', createdAt, updatedAt: createdAt },
    { id: 'contact-3', workspaceId: 'workspace-2', lifecycle: 'lead', name: 'Robert Thompson', company: 'Thompson Group', email: 'robert@businessgroup.com', source: 'phone', estimatedValue: 12000, score: 85, lastInteractionAt: '2024-12-17T12:00:00.000Z', nextActionAt: '2024-12-22T12:00:00.000Z', ownerUserId: 'user-1', attribution: 'rev_assisted', createdAt, updatedAt: createdAt },
    { id: 'contact-4', workspaceId: 'workspace-2', lifecycle: 'prospect', name: 'Patricia Allen', company: 'Allen Family Enterprises', email: 'patricia@family-business.net', source: 'referral', estimatedValue: 18000, score: 72, lastInteractionAt: '2024-12-10T12:00:00.000Z', ownerUserId: 'user-1', attribution: 'owner_generated', createdAt, updatedAt: createdAt },
    // Phase 3D demo-only fixtures: demonstrate won/dormant/attribution states in mock mode. Never sent to Supabase.
    { id: 'contact-5', workspaceId: 'workspace-1', lifecycle: 'customer', name: 'Alicia Nguyen', company: 'Nguyen Design Studio', email: 'alicia@nguyendesign.example', source: 'rev_reactivation', estimatedValue: 22000, score: 95, lastInteractionAt: '2024-12-19T12:00:00.000Z', ownerUserId: 'user-1', attribution: 'rev_recovered', createdAt, updatedAt: createdAt },
    { id: 'contact-6', workspaceId: 'workspace-1', lifecycle: 'former_customer', name: 'Marcus Webb', company: 'Webb Logistics', email: 'marcus@webblogistics.example', source: 'existing_customer', estimatedValue: 9000, score: 40, lastInteractionAt: '2024-10-01T12:00:00.000Z', ownerUserId: 'user-1', attribution: 'unattributed', createdAt, updatedAt: createdAt },
    { id: 'contact-7', workspaceId: 'workspace-2', lifecycle: 'customer', name: 'Diane Foster', company: 'Foster & Co', email: 'diane@fosterco.example', source: 'rev_prospect_discovery', estimatedValue: 30000, score: 90, lastInteractionAt: '2024-12-16T12:00:00.000Z', ownerUserId: 'user-1', attribution: 'rev_generated', createdAt, updatedAt: createdAt },
  ],
  // Phase 3E: Opportunity domain, distinct from Contact. One opportunity per demo contact for now;
  // a contact may have several opportunities over time in the future. Demo-only fixture data.
  opportunities: [
    { id: 'opportunity-1', workspaceId: 'workspace-1', contactId: 'contact-1', title: 'TechStartup Inc — platform rollout', opportunityType: 'commercial_lead', stage: 'follow_up', source: 'website_enquiry', estimatedValue: 15000, currency: 'GBP', attribution: 'rev_assisted', createdByType: 'rev', createdAt, updatedAt: createdAt, lastActivityAt: '2024-12-18T12:00:00.000Z', nextActionAt: '2024-12-21T12:00:00.000Z' },
    { id: 'opportunity-2', workspaceId: 'workspace-1', contactId: 'contact-2', title: 'EcomPro Solutions — proposal', opportunityType: 'commercial_lead', stage: 'qualified', source: 'referral', estimatedValue: 8000, currency: 'GBP', attribution: 'unattributed', createdByType: 'user', createdAt, updatedAt: createdAt, lastActivityAt: '2024-12-15T12:00:00.000Z' },
    { id: 'opportunity-3', workspaceId: 'workspace-2', contactId: 'contact-3', title: 'Thompson Group — estate consultation', opportunityType: 'commercial_lead', stage: 'follow_up', source: 'manual_lead', estimatedValue: 12000, currency: 'GBP', attribution: 'rev_assisted', createdByType: 'rev', createdAt, updatedAt: createdAt, lastActivityAt: '2024-12-17T12:00:00.000Z', nextActionAt: '2024-12-22T12:00:00.000Z' },
    { id: 'opportunity-4', workspaceId: 'workspace-2', contactId: 'contact-4', title: 'Allen Family Enterprises — planning', opportunityType: 'commercial_lead', stage: 'qualified', source: 'referral', estimatedValue: 18000, currency: 'GBP', attribution: 'owner_generated', createdByType: 'user', createdAt, updatedAt: createdAt, lastActivityAt: '2024-12-10T12:00:00.000Z' },
    { id: 'opportunity-5', workspaceId: 'workspace-1', contactId: 'contact-5', title: 'Nguyen Design Studio — reactivated engagement', opportunityType: 'commercial_lead', stage: 'won', source: 'rev_reactivation', estimatedValue: 22000, currency: 'GBP', attribution: 'rev_recovered', createdByType: 'rev', createdAt, updatedAt: createdAt, lastActivityAt: '2024-12-19T12:00:00.000Z', wonAt: '2024-12-19T12:00:00.000Z' },
    { id: 'opportunity-6', workspaceId: 'workspace-1', contactId: 'contact-6', title: 'Webb Logistics — potential reactivation', opportunityType: 'commercial_lead', stage: 'dormant', source: 'existing_customer', estimatedValue: 9000, currency: 'GBP', attribution: 'unattributed', createdByType: 'system', createdAt, updatedAt: createdAt, lastActivityAt: '2024-10-01T12:00:00.000Z' },
    { id: 'opportunity-7', workspaceId: 'workspace-2', contactId: 'contact-7', title: 'Foster & Co — advisory engagement', opportunityType: 'commercial_lead', stage: 'won', source: 'rev_prospect_discovery', estimatedValue: 30000, currency: 'GBP', attribution: 'rev_generated', createdByType: 'rev', createdAt, updatedAt: createdAt, lastActivityAt: '2024-12-16T12:00:00.000Z', wonAt: '2024-12-16T12:00:00.000Z' },
  ],
  actions: [
    { id: 'action-1', workspaceId: 'workspace-1', goalId: 'goal-1', contactId: 'contact-1', actionType: 'outreach', title: 'Prepare Sarah Chen outreach', description: 'Prepare a personalized follow-up message.', rationale: 'Warm, high-value opportunity with recent engagement.', requiresApproval: true, status: 'awaiting_approval', executionStatus: 'not_executed', proposedAt: createdAt },
    { id: 'action-2', workspaceId: 'workspace-2', goalId: 'goal-2', contactId: 'contact-3', actionType: 'follow_up', title: 'Schedule Robert Thompson consultation', description: 'Recommend a consultation time.', rationale: 'Repeated engagement indicates consultation readiness.', requiresApproval: true, status: 'awaiting_approval', executionStatus: 'not_executed', proposedAt: createdAt },
  ],
  approvals: [
    { id: 'approval-1', workspaceId: 'workspace-1', revActionId: 'action-1', requestedAt: createdAt },
    { id: 'approval-2', workspaceId: 'workspace-2', revActionId: 'action-2', requestedAt: createdAt },
  ],
  memoryEvents: [
    { id: 'memory-1', workspaceId: 'workspace-1', eventType: 'LEAD_CONTACTED', entityType: 'contact', entityId: 'contact-1', title: 'Sarah Chen contacted', summary: 'Sarah engaged with the Revive product demonstration.', structuredData: { channel: 'website' }, occurredAt: '2024-12-18T12:00:00.000Z', createdByType: 'user', createdById: 'user-1' },
    { id: 'memory-2', workspaceId: 'workspace-2', eventType: 'FOLLOW_UP_DUE', entityType: 'contact', entityId: 'contact-3', title: 'Robert Thompson follow-up due', summary: 'Initial consultation should be scheduled.', structuredData: { priority: 'high' }, occurredAt: '2024-12-20T12:00:00.000Z', createdByType: 'rev' },
  ],
  auditLogs: [],
};
