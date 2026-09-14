import {
  Workspace,
  User,
  WorkspaceMember,
  BusinessProfile,
  Goal,
  Lead,
  REVAction,
  DailyBrief,
  ApprovalTask,
  BusinessMemory,
} from '@/types';

// Mock Current User
export const mockCurrentUser: User = {
  id: 'user-1',
  email: 'mike@revive.ai',
  displayName: 'Mike',
  createdAt: new Date('2024-01-01'),
};

// Mock Workspaces
export const mockWorkspaces: Workspace[] = [
  {
    id: 'workspace-1',
    name: 'Revive',
    slug: 'revive',
    ownerId: 'user-1',
    status: 'active',
    subscriptionTier: 'professional',
    monthlyActionQuota: 500,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    id: 'workspace-2',
    name: 'Family Legacy',
    slug: 'family-legacy',
    ownerId: 'user-1',
    status: 'active',
    subscriptionTier: 'starter',
    monthlyActionQuota: 100,
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-15'),
  },
];

// Mock Workspace Members
export const mockWorkspaceMembers: WorkspaceMember[] = [
  {
    id: 'member-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    role: 'owner',
    permissions: ['*'],
    createdAt: new Date('2024-01-01'),
  },
  {
    id: 'member-2',
    workspaceId: 'workspace-2',
    userId: 'user-1',
    role: 'owner',
    permissions: ['*'],
    createdAt: new Date('2024-02-01'),
  },
];

// Business Profiles
const reviveBusinessProfile: BusinessProfile = {
  id: 'bp-1',
  workspaceId: 'workspace-1',
  businessName: 'Revive',
  description: 'AI platform for small business growth',
  brandVoice: 'professional, innovative, trustworthy',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

const familyLegacyBusinessProfile: BusinessProfile = {
  id: 'bp-2',
  workspaceId: 'workspace-2',
  businessName: 'Family Legacy Planning',
  description: 'Estate planning and family business succession',
  brandVoice: 'professional, caring, detail-oriented',
  createdAt: new Date('2024-02-01'),
  updatedAt: new Date('2024-02-15'),
};

export const mockBusinessProfiles = [reviveBusinessProfile, familyLegacyBusinessProfile];

// Goals for Revive Workspace
const reviveGoals: Goal[] = [
  {
    id: 'goal-1',
    workspaceId: 'workspace-1',
    ownerId: 'user-1',
    objective: 'Book 5 new sales meetings this month',
    metric: 'meetings_booked',
    targetValue: 5,
    timeframe: 'monthly',
    currentProgress: 2,
    status: 'on_track',
    priority: 'high',
    startedAt: new Date('2024-12-01'),
    targetCompletionAt: new Date('2024-12-31'),
    createdAt: new Date('2024-12-01'),
    updatedAt: new Date('2024-12-20'),
  },
  {
    id: 'goal-2',
    workspaceId: 'workspace-1',
    ownerId: 'user-1',
    objective: 'Increase customer retention to 95%',
    metric: 'retention_rate',
    targetValue: 95,
    timeframe: 'quarterly',
    currentProgress: 92,
    status: 'on_track',
    priority: 'medium',
    startedAt: new Date('2024-10-01'),
    targetCompletionAt: new Date('2024-12-31'),
    createdAt: new Date('2024-10-01'),
    updatedAt: new Date('2024-12-20'),
  },
];

// Goals for Family Legacy Workspace
const familyLegacyGoals: Goal[] = [
  {
    id: 'goal-3',
    workspaceId: 'workspace-2',
    ownerId: 'user-1',
    objective: 'Complete 3 estate plans this quarter',
    metric: 'plans_completed',
    targetValue: 3,
    timeframe: 'quarterly',
    currentProgress: 1,
    status: 'at_risk',
    priority: 'high',
    startedAt: new Date('2024-10-01'),
    targetCompletionAt: new Date('2024-12-31'),
    createdAt: new Date('2024-10-01'),
    updatedAt: new Date('2024-12-20'),
  },
];

export const mockGoals = [...reviveGoals, ...familyLegacyGoals];

// Leads for Revive Workspace
const reviveLeads: Lead[] = [
  {
    id: 'lead-1',
    workspaceId: 'workspace-1',
    name: 'Sarah Chen',
    email: 'sarah@techstartup.io',
    phone: '(555) 123-4567',
    company: 'TechStartup Inc',
    status: 'lead',
    estimatedValue: 15000,
    source: 'website',
    lastInteraction: new Date('2024-12-18'),
    nextAction: 'Schedule discovery call',
    owner: 'Mike',
    revScore: 92,
    createdAt: new Date('2024-12-10'),
    updatedAt: new Date('2024-12-18'),
  },
  {
    id: 'lead-2',
    workspaceId: 'workspace-1',
    name: 'James Rodriguez',
    email: 'james@ecommerce.co',
    company: 'EcomPro Solutions',
    status: 'prospect',
    estimatedValue: 8000,
    source: 'referral',
    lastInteraction: new Date('2024-12-15'),
    nextAction: 'Send proposal',
    owner: 'Mike',
    revScore: 78,
    createdAt: new Date('2024-12-05'),
    updatedAt: new Date('2024-12-15'),
  },
  {
    id: 'lead-3',
    workspaceId: 'workspace-1',
    name: 'Emily Watson',
    email: 'emily@consulting.biz',
    company: 'Watson Consulting',
    status: 'customer',
    estimatedValue: 25000,
    source: 'email',
    lastInteraction: new Date('2024-12-19'),
    nextAction: 'Renewal discussion in January',
    owner: 'Mike',
    revScore: 98,
    createdAt: new Date('2024-09-01'),
    updatedAt: new Date('2024-12-19'),
  },
];

// Leads for Family Legacy Workspace
const familyLegacyLeads: Lead[] = [
  {
    id: 'lead-4',
    workspaceId: 'workspace-2',
    name: 'Robert Thompson',
    email: 'robert@businessgroup.com',
    company: 'Thompson Group',
    status: 'lead',
    estimatedValue: 12000,
    source: 'phone',
    lastInteraction: new Date('2024-12-17'),
    nextAction: 'Initial consultation scheduled',
    owner: 'Mike',
    revScore: 85,
    createdAt: new Date('2024-12-08'),
    updatedAt: new Date('2024-12-17'),
  },
  {
    id: 'lead-5',
    workspaceId: 'workspace-2',
    name: 'Patricia Allen',
    email: 'patricia@family-business.net',
    company: 'Allen Family Enterprises',
    status: 'prospect',
    estimatedValue: 18000,
    source: 'referral',
    lastInteraction: new Date('2024-12-10'),
    nextAction: 'Send information packet',
    owner: 'Mike',
    revScore: 72,
    createdAt: new Date('2024-11-25'),
    updatedAt: new Date('2024-12-10'),
  },
];

export const mockLeads = [...reviveLeads, ...familyLegacyLeads];

// REV Actions for Revive Workspace
const reviveActions: REVAction[] = [
  {
    id: 'action-1',
    workspaceId: 'workspace-1',
    type: 'research',
    description: 'Researched 14 prospects in Tech industry matching Revive profile',
    status: 'completed',
    proposedBy: 'rev',
    executedAt: new Date('2024-12-19'),
    result: 'Found 8 strong matches for outreach',
    createdAt: new Date('2024-12-19'),
    updatedAt: new Date('2024-12-19'),
  },
  {
    id: 'action-2',
    workspaceId: 'workspace-1',
    type: 'outreach',
    description: 'Prepared 6 personalized outreach messages to qualified leads',
    status: 'approved',
    proposedBy: 'rev',
    approvedBy: 'user-1',
    createdAt: new Date('2024-12-19'),
    updatedAt: new Date('2024-12-19'),
  },
];

const familyLegacyActions: REVAction[] = [
  {
    id: 'action-3',
    workspaceId: 'workspace-2',
    type: 'research',
    description: 'Identified estate planning prospects in high-net-worth segment',
    status: 'completed',
    proposedBy: 'rev',
    executedAt: new Date('2024-12-18'),
    result: 'Found 5 high-potential prospects',
    createdAt: new Date('2024-12-18'),
    updatedAt: new Date('2024-12-18'),
  },
];

export const mockREVActions = [...reviveActions, ...familyLegacyActions];

// Daily Briefs
const reviveDailyBrief: DailyBrief = {
  id: 'brief-1',
  workspaceId: 'workspace-1',
  date: new Date('2024-12-20'),
  hotLeads: 3,
  repliesNeeded: 4,
  followUpsDue: 2,
  meetingsToday: 1,
  revWorkedResearch: 14,
  revWorkedMatches: 8,
  revWorkedOutreach: 6,
  revWorkedReplies: 3,
  recommendation: 'Respond to the highest-value opportunity first (Sarah Chen). Her timeline is urgent and she has indicated strong product-market fit.',
  createdAt: new Date('2024-12-20'),
};

const familyLegacyDailyBrief: DailyBrief = {
  id: 'brief-2',
  workspaceId: 'workspace-2',
  date: new Date('2024-12-20'),
  hotLeads: 1,
  repliesNeeded: 2,
  followUpsDue: 1,
  meetingsToday: 0,
  revWorkedResearch: 5,
  revWorkedMatches: 3,
  revWorkedOutreach: 2,
  revWorkedReplies: 1,
  recommendation: 'Schedule the consultation with Robert Thompson. Move consultation to next available Tuesday slot.',
  createdAt: new Date('2024-12-20'),
};

export const mockDailyBriefs = [reviveDailyBrief, familyLegacyDailyBrief];

// Approval Tasks
const reviveApprovals: ApprovalTask[] = [
  {
    id: 'approval-1',
    workspaceId: 'workspace-1',
    type: 'outreach',
    description: 'REV has prepared outreach for Sarah Chen (TechStartup Inc)',
    revReasoning: 'Sarah is a qualified lead with high value potential. She engaged with product demo 2 days ago. This is a warm follow-up.',
    draftMessage: `Hi Sarah,

I hope your week is going well. I wanted to follow up on your interest in REV from our product demo earlier this week.

Given your scaling challenges with lead management at TechStartup, I think REV could save your team 10+ hours per week on prospecting and follow-ups.

Would you be available for a brief 20-minute call next Tuesday or Wednesday to explore how this might work for your team?

Best,
Mike`,
    status: 'pending',
    createdAt: new Date('2024-12-19'),
    updatedAt: new Date('2024-12-19'),
  },
];

const familyLegacyApprovals: ApprovalTask[] = [
  {
    id: 'approval-2',
    workspaceId: 'workspace-2',
    type: 'communication',
    description: 'REV recommends scheduling initial consultation',
    revReasoning: 'Robert Thompson has engaged twice. Consultation request is warmly received based on engagement patterns.',
    status: 'pending',
    createdAt: new Date('2024-12-18'),
    updatedAt: new Date('2024-12-18'),
  },
];

export const mockApprovalTasks = [...reviveApprovals, ...familyLegacyApprovals];

// Business Memory (Business Brain)
const reviveBusinessMemory: BusinessMemory = {
  id: 'bm-1',
  workspaceId: 'workspace-1',
  businessName: 'Revive',
  services: ['AI platform for small business growth', 'Lead management', 'Sales automation', 'Business intelligence'],
  targetCustomers: 'Small business owners (5-50 employees), service providers, ecommerce sellers',
  locations: ['Remote-first', 'HQ: US-based'],
  openingHours: { Mon: '9am-6pm EST', Tue: '9am-6pm EST', Wed: '9am-6pm EST', Thu: '9am-6pm EST', Fri: '9am-6pm EST' },
  faqs: [
    { question: 'How does REV work?', answer: 'REV uses AI to analyze your business and generate personalized recommendations for growth.' },
    { question: 'What integrations are available?', answer: 'Phase 2A: Mocked. Future: Email, Calendar, SMS, Prospect APIs.' },
  ],
  brandVoice: 'Professional, innovative, trustworthy, empowering small business owners',
  integrations: { email: false, calendar: false, sms: false },
  revPermissions: { autonomous_outreach: false, auto_approval: false, data_collection: true },
  lastUpdated: new Date('2024-12-15'),
};

const familyLegacyBusinessMemory: BusinessMemory = {
  id: 'bm-2',
  workspaceId: 'workspace-2',
  businessName: 'Family Legacy Planning',
  services: ['Estate planning', 'Business succession planning', 'Wealth transfer', 'Family governance'],
  targetCustomers: 'High-net-worth families, family business owners, entrepreneurs',
  locations: ['New York', 'Remote consultation available'],
  openingHours: { Mon: '10am-5pm EST', Tue: '10am-5pm EST', Wed: '10am-5pm EST', Thu: '10am-5pm EST', Fri: '10am-4pm EST' },
  faqs: [
    { question: 'What is estate planning?', answer: 'Estate planning ensures your wealth and business are preserved and transferred according to your wishes.' },
    { question: 'How long does planning take?', answer: 'Typically 2-4 months for comprehensive planning, depending on complexity.' },
  ],
  brandVoice: 'Caring, detail-oriented, trustworthy, professional, family-focused',
  integrations: { email: false, calendar: false, sms: false },
  revPermissions: { autonomous_outreach: false, auto_approval: false, data_collection: true },
  lastUpdated: new Date('2024-12-10'),
};

export const mockBusinessMemories = [reviveBusinessMemory, familyLegacyBusinessMemory];

// Helper function to get data for current workspace
export function getWorkspaceData(workspaceId: string) {
  return {
    workspace: mockWorkspaces.find((w) => w.id === workspaceId),
    goals: mockGoals.filter((g) => g.workspaceId === workspaceId),
    leads: mockLeads.filter((l) => l.workspaceId === workspaceId),
    actions: mockREVActions.filter((a) => a.workspaceId === workspaceId),
    dailyBrief: mockDailyBriefs.find((b) => b.workspaceId === workspaceId),
    approvals: mockApprovalTasks.filter((a) => a.workspaceId === workspaceId),
    businessProfile: mockBusinessProfiles.find((p) => p.workspaceId === workspaceId),
    businessMemory: mockBusinessMemories.find((m) => m.workspaceId === workspaceId),
  };
}
