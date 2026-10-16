import { describe, expect, it } from 'vitest';
import { activeCaseloadConnections, authorisedCaseload, caseloadExportRows, createCaseloadWorkbook, filterCaseload, readCompleteProgrammeRows } from '@/services/programmeCaseloadReporting';
import type { ProgrammeHubData, ProgrammeHubParticipant } from '@/domain/programmeHub';
const person: ProgrammeHubParticipant = { id: 'person', workspaceId: 'workspace', programmeId: 'programme', participantKey: '=DANGEROUS()', preferredName: 'Alex & <Sam>', caseReference: '00123', desiredRoleKeys: [], skillKeys: [], vacancySearchGeographyKeys: [], residencyEvidenceReference: 'PRIVATE ADDRESS EVIDENCE', active: true, version: 1 };
function fixture(): ProgrammeHubData {
  return { programmes: [{ id: 'programme', workspaceId: 'workspace', name: 'Work support', timezone: 'Europe/London', brandingName: null, senderDisplayName: null, senderReplyTo: null, active: true, version: 1 }], advisers: [{ id: 'adviser', workspaceId: 'workspace', programmeId: 'programme', userId: 'es', active: true, version: 1 }], employers: [], contacts: [], vacancies: [], participants: [person], participantAdvisers: [{ id: 'assignment', workspaceId: 'workspace', programmeId: 'programme', participantId: 'person', adviserUserId: 'es', active: true, version: 1, createdAt: '2026-10-09T08:00:00Z', updatedAt: '2026-10-10T08:00:00Z' }], participantNotes: [], contracts: [], members: [{ userId: 'manager', role: 'owner', status: 'active' }, { userId: 'es', role: 'member', status: 'active' }] };
}
const filters = { specialist: 'all', status: 'all' as const, search: '' };

describe('authorised caseload reporting', () => {
  it('keeps programme/workspace scope and does not export private fields', () => {
    const data = fixture();
    data.participants.push({ ...person, id: 'other-workspace', workspaceId: 'elsewhere' }, { ...person, id: 'other-programme', programmeId: 'elsewhere' });
    const rows = caseloadExportRows(data, 'workspace', 'programme', 'manager', filters);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['Work support', '=DANGEROUS()', 'Alex & <Sam>', '00123', 'Active', 'Employment Specialist ending es', '2026-10-09T08:00:00.000Z', '2026-10-10T08:00:00.000Z']);
    expect(JSON.stringify(rows)).not.toContain('PRIVATE ADDRESS EVIDENCE');
  });
  it('denies viewers, suspended members, absent programmes and inactive ES registrations', () => {
    for (const role of ['viewer', 'member'] as const) {
      const data = fixture(); data.members[0].role = role;
      expect(() => authorisedCaseload(data, 'workspace', 'programme', 'manager')).toThrow(/access/);
    }
    const data = fixture(); data.members[0].status = 'suspended';
    expect(() => authorisedCaseload(data, 'workspace', 'programme', 'manager')).toThrow(/access/);
    data.advisers[0].active = false;
    expect(() => authorisedCaseload(data, 'workspace', 'programme', 'es')).toThrow(/access/);
    expect(() => authorisedCaseload(fixture(), 'workspace', 'other-programme', 'manager')).toThrow(/access/);
  });
  it('excludes inactive, suspended and foreign connections; an ES can only export their own assigned rows', () => {
    const data = fixture();
    data.participants.push({ ...person, id: 'unassigned' });
    expect(caseloadExportRows(data, 'workspace', 'programme', 'es', { ...filters, specialist: 'es' })).toHaveLength(1);
    expect(() => caseloadExportRows(data, 'workspace', 'programme', 'es', filters)).toThrow(/Only your assigned/);
    data.members[1].status = 'suspended';
    expect(activeCaseloadConnections(person, data)).toHaveLength(0);
    data.members[1].status = 'active'; data.participantAdvisers[0].programmeId = 'other';
    expect(activeCaseloadConnections(person, data)).toHaveLength(0);
    data.participantAdvisers[0].programmeId = 'programme'; data.participantAdvisers[0].active = false;
    expect(activeCaseloadConnections(person, data)).toHaveLength(0);
  });
  it('counts a person once even with multiple active ES connections and applies status and whitespace search', () => {
    const data = fixture(); data.participants[0] = { ...person, preferredName: 'Alex Jordan' };
    data.participantAdvisers.push({ ...data.participantAdvisers[0], id: 'second-connection' });
    expect(filterCaseload(data.participants, data, 'manager', { ...filters, specialist: 'es', search: ' alex   jordan ' })).toHaveLength(1);
    expect(filterCaseload(data.participants, data, 'manager', { ...filters, status: 'inactive' })).toHaveLength(0);
    expect(filterCaseload(data.participants, data, 'manager', { ...filters, specialist: 'unassigned' })).toHaveLength(0);
  });
});

describe('complete counted reads', () => {
  it('reads beyond the default API row cap using ordered ranges', async () => {
    const source = Array.from({ length: 1201 }, (_, id) => ({ id: String(id) }));
    const calls: Array<[number, number]> = [];
    const rows = await readCompleteProgrammeRows(async (from, to) => { calls.push([from, to]); return { data: source.slice(from, to + 1), error: null, count: source.length }; }, 'id');
    expect(rows).toHaveLength(1201); expect(calls).toHaveLength(7); expect(rows[1200].id).toBe('1200');
  });
  it('handles a lower server page cap without mistaking it for a complete result', async () => {
    const source = Array.from({ length: 21 }, (_, id) => ({ user_id: String(id) }));
    const rows = await readCompleteProgrammeRows(async (from) => ({ data: source.slice(from, from + 5), error: null, count: source.length }), 'user_id');
    expect(rows).toHaveLength(21);
  });
  it('refuses incomplete, duplicate, changed, uncounted and excessive reads', async () => {
    await expect(readCompleteProgrammeRows(async () => ({ data: [], error: null, count: 1 }), 'id')).rejects.toThrow(/complete/);
    await expect(readCompleteProgrammeRows(async () => ({ data: [{ id: 'same' }, { id: 'same' }], error: null, count: 2 }), 'id')).rejects.toThrow(/verified/);
    await expect(readCompleteProgrammeRows(async (from) => ({ data: [{ id: String(from) }], error: null, count: from ? 3 : 2 }), 'id')).rejects.toThrow(/changed/);
    await expect(readCompleteProgrammeRows(async () => ({ data: [], error: null, count: null }), 'id')).rejects.toThrow(/complete/);
    await expect(readCompleteProgrammeRows(async () => ({ data: [], error: null, count: 10001 }), 'id')).rejects.toThrow(/complete/);
  });
  it('never returns the first page after a later read failure', async () => {
    await expect(readCompleteProgrammeRows(async (from) => ({ data: from ? null : [{ id: 'first' }], error: from ? new Error('failed') : null, count: 2 }), 'id')).rejects.toThrow(/complete/);
  });
});

describe('Excel text-only export', () => {
  it('stores formulas and markup as inline text and preserves leading zero case references', () => {
    const rows = caseloadExportRows(fixture(), 'workspace', 'programme', 'manager', filters);
    const bytes = createCaseloadWorkbook(rows);
    expect([...bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
    const xml = new TextDecoder().decode(bytes);
    expect(xml).toContain('t="inlineStr"'); expect(xml).not.toContain('<f>');
    expect(xml).toContain('=DANGEROUS()'); expect(xml).toContain('Alex &amp; &lt;Sam&gt;'); expect(xml).toContain('00123');
    expect(xml).not.toContain('PRIVATE ADDRESS EVIDENCE'); expect(xml).not.toContain('TargetMode="External"');
  });
  it('refuses empty, malformed or oversized exports', () => {
    expect(() => createCaseloadWorkbook([])).toThrow();
    expect(() => createCaseloadWorkbook([['bad']])).toThrow();
    expect(() => createCaseloadWorkbook([Array(8).fill('x'.repeat(32768))])).toThrow();
  });
});
