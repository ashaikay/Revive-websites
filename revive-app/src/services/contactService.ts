import { DataProvider } from '@/domain/repositories';
import { ContactLifecycle, ContactRecord } from '@/domain/models';
import { BusinessMemoryService } from './businessMemoryService';
import { recordAudit } from './auditService';

export class ContactService {
  private readonly memory: BusinessMemoryService;

  constructor(private readonly provider: DataProvider) {
    this.memory = new BusinessMemoryService(provider);
  }

  list(workspaceId: string): ContactRecord[] { return this.provider.contacts.list(workspaceId); }

  create(input: Omit<ContactRecord, 'id' | 'createdAt' | 'updatedAt'>): ContactRecord {
    const timestamp = new Date().toISOString();
    const contact = this.provider.contacts.save({ ...input, id: `contact-${Date.now()}`, createdAt: timestamp, updatedAt: timestamp });
    recordAudit(this.provider, { workspaceId: contact.workspaceId, actorType: 'user', action: 'contact.created', resourceType: 'contact', resourceId: contact.id });
    return contact;
  }

  update(workspaceId: string, contactId: string, changes: Partial<Omit<ContactRecord, 'id' | 'workspaceId' | 'createdAt'>>): ContactRecord {
    const contact = this.requireContact(workspaceId, contactId);
    const updated = this.provider.contacts.save({ ...contact, ...changes, updatedAt: new Date().toISOString() });
    recordAudit(this.provider, { workspaceId, actorType: 'user', action: 'contact.updated', resourceType: 'contact', resourceId: contactId });
    return updated;
  }

  changeLifecycle(workspaceId: string, contactId: string, lifecycle: ContactLifecycle): ContactRecord {
    const contact = this.update(workspaceId, contactId, { lifecycle });
    this.memory.record({
      workspaceId, eventType: `CONTACT_${lifecycle.toUpperCase()}`, entityType: 'contact', entityId: contactId,
      title: `${contact.name} moved to ${lifecycle}`, summary: `Contact lifecycle changed to ${lifecycle}.`, structuredData: { lifecycle },
      occurredAt: new Date().toISOString(), createdByType: 'user',
    });
    return contact;
  }

  setNextAction(workspaceId: string, contactId: string, nextActionAt: string): ContactRecord {
    const contact = this.update(workspaceId, contactId, { nextActionAt });
    this.memory.record({
      workspaceId, eventType: 'FOLLOW_UP_DUE', entityType: 'contact', entityId: contactId,
      title: `Follow-up scheduled for ${contact.name}`, summary: `Next action scheduled for ${nextActionAt}.`, structuredData: { nextActionAt },
      occurredAt: new Date().toISOString(), createdByType: 'user',
    });
    return contact;
  }

  private requireContact(workspaceId: string, contactId: string): ContactRecord {
    const contact = this.provider.contacts.get(workspaceId, contactId);
    if (!contact) throw new Error(`Contact ${contactId} was not found in workspace ${workspaceId}`);
    return contact;
  }
}
