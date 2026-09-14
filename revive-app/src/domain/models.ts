export type Id = string;

export type WorkspaceStatus = 'active' | 'paused' | 'archived';
export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';
export type MemberStatus = 'invited' | 'active' | 'suspended';
export type GoalPriority = 'high' | 'medium' | 'low';
export type GoalStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type ContactLifecycle = 'prospect' | 'lead' | 'customer' | 'former_customer';
export type ActionStatus = 'proposed' | 'awaiting_approval' | 'approved' | 'rejected' | 'cancelled' | 'completed' | 'failed';
export type ExecutionStatus = 'not_started' | 'not_executed' | 'in_progress' | 'succeeded' | 'failed';
export type ApprovalDecision = 'approved' | 'rejected' | 'edited';
export type ActorType = 'user' | 'rev' | 'system';
/** How much of a contact's commercial opportunity is evidenced as REV's contribution; never inferred, only ever explicitly recorded. */
export type AttributionCategory = 'owner_generated' | 'rev_generated' | 'rev_assisted' | 'rev_recovered' | 'unattributed';

/**
 * Opportunity domain (Phase 3E). Distinct from Contact: a Contact is who the person/business is;
 * an Opportunity is a specific commercial pursuit tied to that contact. A contact may have several
 * opportunities over time. Only stages genuinely evidenced by recorded activity are ever assigned;
 * see PHASE_3E docs for the stages that still require future Conversation/Appointment/Quote records.
 */
export type OpportunityStage =
  | 'new'
  | 'qualified'
  | 'contacted'
  | 'conversation'
  | 'appointment'
  | 'quote'
  | 'follow_up'
  | 'won'
  | 'lost'
  | 'dormant';

export type OpportunitySource =
  | 'existing_customer'
  | 'referral'
  | 'website_enquiry'
  | 'manual_lead'
  | 'rev_prospect_discovery'
  | 'rev_reactivation'
  | 'tender'
  | 'grant'
  | 'campaign'
  | 'social'
  | 'partner'
  | 'other';

export type OpportunityType = 'commercial_lead' | 'tender' | 'contract' | 'grant' | 'partnership';

export interface OpportunityRecord {
  id: Id;
  workspaceId: Id;
  contactId: Id;
  title: string;
  description?: string;
  opportunityType: OpportunityType;
  stage: OpportunityStage;
  source: OpportunitySource;
  estimatedValue?: number;
  currency: string;
  /** 0-1 evidence-based estimate; absent means not yet assessed, never fabricated. */
  probability?: number;
  attribution: AttributionCategory;
  createdByType: ActorType;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string;
  nextActionAt?: string;
  wonAt?: string;
  lostAt?: string;
  lostReason?: string;
}

/** Transparent, criteria-based fit assessment for a prospect candidate; never a bare AI confidence number. */
export interface FitScoreBreakdown {
  serviceMatch: number;
  geographicMatch: number;
  companyTypeMatch: number;
  opportunityTrigger: number;
  contactability: number;
}

export interface ProspectCandidate {
  id: Id;
  workspaceId: Id;
  name: string;
  company?: string;
  source: OpportunitySource;
  whyFound: string;
  whyRelevant: string;
  evidence: string[];
  fitScore: FitScoreBreakdown;
  discoveredAt: string;
}

export type OutreachStatus =
  | 'draft'
  | 'ready_for_approval'
  | 'approved'
  | 'queued'
  | 'sent'
  | 'replied'
  | 'follow_up_due'
  | 'converted'
  | 'closed'
  | 'suppressed';

export interface OutreachAttemptRecord {
  id: Id;
  workspaceId: Id;
  opportunityId: Id;
  revActionId?: Id;
  status: OutreachStatus;
  channel: 'email' | 'phone' | 'other';
  draftMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SuppressionRecord {
  contactId: Id;
  workspaceId: Id;
  reason: 'do_not_contact' | 'unsubscribed' | 'bounced' | 'invalid_contact' | 'frequency_cap';
  recordedAt: string;
}

export interface WorkspaceRecord {
  id: Id;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMemberRecord {
  workspaceId: Id;
  userId: Id;
  role: MemberRole;
  status: MemberStatus;
  joinedAt: string;
}

export interface BusinessProfileRecord {
  workspaceId: Id;
  businessName: string;
  description: string;
  website?: string;
  industry?: string;
  targetCustomers: string;
  serviceAreas: string[];
  openingHours: Record<string, string>;
  differentiators: string[];
  brandVoice: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessServiceRecord {
  id: Id;
  workspaceId: Id;
  name: string;
  description: string;
  priceInformation?: string;
  active: boolean;
}

export interface GoalRecord {
  id: Id;
  workspaceId: Id;
  title: string;
  objective: string;
  metric: string;
  targetValue: number;
  currentValue: number;
  startDate: string;
  targetDate: string;
  priority: GoalPriority;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ContactRecord {
  id: Id;
  workspaceId: Id;
  lifecycle: ContactLifecycle;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  source?: string;
  estimatedValue?: number;
  score?: number;
  lastInteractionAt?: string;
  nextActionAt?: string;
  ownerUserId?: Id;
  /** Evidence-based REV contribution; absent/undefined must be treated as 'unattributed', never assumed. */
  attribution?: AttributionCategory;
  /** Compliance/suppression: when true, no outreach may be prepared for this contact. */
  doNotContact?: boolean;
  suppressionReason?: SuppressionRecord['reason'];
  createdAt: string;
  updatedAt: string;
}

export interface REVActionRecord {
  id: Id;
  workspaceId: Id;
  goalId?: Id;
  contactId?: Id;
  opportunityId?: Id;
  actionType: string;
  title: string;
  description: string;
  rationale?: string;
  requiresApproval: boolean;
  status: ActionStatus;
  executionStatus: ExecutionStatus;
  proposedAt: string;
  approvedAt?: string;
  executedAt?: string;
  outcomeSummary?: string;
}

export interface ApprovalRecord {
  id: Id;
  workspaceId: Id;
  revActionId: Id;
  requestedAt: string;
  actionFingerprint?: string;
  decidedAt?: string;
  decidedBy?: Id;
  decision?: ApprovalDecision;
  notes?: string;
}

export interface BusinessMemoryEventRecord {
  id: Id;
  workspaceId: Id;
  eventType: string;
  entityType: string;
  entityId?: Id;
  title: string;
  summary: string;
  structuredData: Record<string, unknown>;
  occurredAt: string;
  createdByType: ActorType;
  createdById?: Id;
}

export interface AuditLogRecord {
  id: Id;
  workspaceId: Id;
  actorUserId?: Id;
  actorType: ActorType;
  action: string;
  resourceType: string;
  resourceId?: Id;
  metadata: Record<string, unknown>;
  timestamp: string;
}
