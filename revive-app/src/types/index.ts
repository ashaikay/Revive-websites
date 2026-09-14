// Core domain types for REV platform

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  status: 'active' | 'paused' | 'archived';
  subscriptionTier: 'free' | 'starter' | 'professional';
  monthlyActionQuota: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'owner' | 'admin' | 'operator' | 'viewer';
  permissions: string[];
  createdAt: Date;
}

export interface BusinessProfile {
  id: string;
  workspaceId: string;
  businessName: string;
  description: string;
  brandVoice: string; // e.g., "professional", "casual"
  logoUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Goal {
  id: string;
  workspaceId: string;
  ownerId: string;
  objective: string; // e.g., "Book 5 sales meetings this month"
  metric: string; // e.g., "meetings_booked"
  targetValue: number;
  timeframe: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  currentProgress: number;
  status: 'on_track' | 'at_risk' | 'stalled' | 'completed' | 'archived';
  priority: 'high' | 'medium' | 'low';
  startedAt: Date;
  targetCompletionAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Lead {
  id: string;
  workspaceId: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  status: 'prospect' | 'lead' | 'customer' | 'archived';
  estimatedValue?: number;
  source?: string; // "email", "phone", "website", "referral", etc.
  lastInteraction?: Date;
  nextAction?: string;
  owner?: string;
  revScore?: number; // AI-generated lead score
  createdAt: Date;
  updatedAt: Date;
}

export interface REVAction {
  id: string;
  workspaceId: string;
  type: 'research' | 'outreach' | 'follow_up' | 'meeting_prep' | string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  proposedBy: 'rev'; // REV AI generated this
  approvedBy?: string;
  executedAt?: Date;
  result?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DailyBrief {
  id: string;
  workspaceId: string;
  date: Date;
  hotLeads: number;
  repliesNeeded: number;
  followUpsDue: number;
  meetingsToday: number;
  revWorkedResearch: number;
  revWorkedMatches: number;
  revWorkedOutreach: number;
  revWorkedReplies: number;
  recommendation: string;
  createdAt: Date;
}

export interface ApprovalTask {
  id: string;
  workspaceId: string;
  type: 'outreach' | 'communication' | 'commitment';
  description: string;
  revReasoning: string;
  draftMessage?: string;
  status: 'pending' | 'approved' | 'edited' | 'rejected';
  approvedBy?: string;
  editedMessage?: string;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BusinessMemory {
  id: string;
  workspaceId: string;
  businessName: string;
  services: string[];
  targetCustomers: string;
  locations?: string[];
  openingHours?: Record<string, string>;
  faqs?: Array<{ question: string; answer: string }>;
  brandVoice: string;
  integrations?: Record<string, boolean>;
  revPermissions?: Record<string, boolean>;
  lastUpdated: Date;
}
