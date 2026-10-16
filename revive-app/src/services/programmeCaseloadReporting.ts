import type { ProgrammeHubData, ProgrammeHubParticipant } from '@/domain/programmeHub';

export const caseloadColumns = ['Programme', 'Service user ID', 'Known as', 'Case reference', 'Record status', 'Assigned Employment Specialists', 'First active assignment (UTC)', 'Latest assignment update (UTC)'];
export type CaseloadFilters = { specialist: string; status: 'all' | 'active' | 'inactive'; search: string };
export const normaliseCaseloadSearch = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB');
export function specialistLabel(id: string, data: ProgrammeHubData, actor: string) {
  const displayName = data.members.find((member) => member.userId === id)?.displayName?.trim();
  if (displayName) return id === actor ? `${displayName} (you)` : displayName;
  if (id === actor) return 'You';
  const role = data.members.find((member) => member.userId === id)?.role;
  return `${role === 'owner' ? 'Owner' : role === 'admin' ? 'Administrator' : 'Employment Specialist'} ending ${id.slice(-6)}`;
}
export function activeCaseloadConnections(participant: ProgrammeHubParticipant, data: ProgrammeHubData) {
  return data.participantAdvisers.filter((assignment) => assignment.workspaceId === participant.workspaceId && assignment.programmeId === participant.programmeId && assignment.participantId === participant.id && assignment.active
    && data.advisers.some((adviser) => adviser.workspaceId === participant.workspaceId && adviser.programmeId === participant.programmeId && adviser.userId === assignment.adviserUserId && adviser.active)
    && data.members.some((member) => member.userId === assignment.adviserUserId && member.status === 'active'));
}
export function authorisedCaseload(data: ProgrammeHubData, workspaceId: string, programmeId: string, actor: string) {
  const member = data.members.find((item) => item.userId === actor && item.status === 'active');
  const programme = data.programmes.find((item) => item.id === programmeId && item.workspaceId === workspaceId);
  const manager = member?.role === 'owner' || member?.role === 'admin';
  const specialist = data.advisers.some((item) => item.workspaceId === workspaceId && item.programmeId === programmeId && item.userId === actor && item.active);
  if (!programme || !member || (!manager && !specialist)) throw new Error('Caseload access is unavailable.');
  const participants = data.participants.filter((item) => item.workspaceId === workspaceId && item.programmeId === programmeId && (manager || activeCaseloadConnections(item, data).some((assignment) => assignment.adviserUserId === actor)));
  return { programme, manager, participants };
}
export function filterCaseload(participants: ProgrammeHubParticipant[], data: ProgrammeHubData, actor: string, filters: CaseloadFilters) {
  const query = normaliseCaseloadSearch(filters.search);
  return participants.filter((participant) => {
    const assignments = activeCaseloadConnections(participant, data);
    return (filters.status === 'all' || participant.active === (filters.status === 'active'))
      && (filters.specialist === 'all' || (filters.specialist === 'unassigned' ? assignments.length === 0 : assignments.some((assignment) => assignment.adviserUserId === filters.specialist)))
      && [participant.preferredName, participant.caseReference, ...assignments.map((assignment) => specialistLabel(assignment.adviserUserId, data, actor))].some((value) => normaliseCaseloadSearch(value).includes(query));
  });
}
export function caseloadExportRows(data: ProgrammeHubData, workspaceId: string, programmeId: string, actor: string, filters: CaseloadFilters) {
  const scope = authorisedCaseload(data, workspaceId, programmeId, actor);
  if (!scope.manager && filters.specialist !== actor) throw new Error('Only your assigned caseload can be exported.');
  return filterCaseload(scope.participants, data, actor, filters).map((participant) => {
    const assignments = activeCaseloadConnections(participant, data);
    const created = assignments.map((item) => item.createdAt).filter((value): value is string => !!value).sort((a, b) => Date.parse(a) - Date.parse(b));
    const updated = assignments.map((item) => item.updatedAt).filter((value): value is string => !!value).sort((a, b) => Date.parse(a) - Date.parse(b));
    return [scope.programme.name, participant.participantKey, participant.preferredName, participant.caseReference, participant.active ? 'Active' : 'Inactive',
      assignments.map((item) => specialistLabel(item.adviserUserId, data, actor)).join('; '), created[0] ? new Date(created[0]).toISOString() : '', updated.length ? new Date(updated[updated.length - 1]).toISOString() : ''];
  });
}

// Counted, ordered pages prevent a capped API response being presented as a complete caseload.
export async function readCompleteProgrammeRows(readPage: (from: number, to: number) => Promise<{ data: unknown; error: unknown; count: number | null }>, key: 'id' | 'user_id') {
  const result: Record<string, unknown>[] = [], seen = new Set<string>();
  let expected: number | null = null;
  for (let page = 0; page < 100; page++) {
    const response = await readPage(result.length, result.length + 199);
    if (response.error || !Array.isArray(response.data) || !Number.isSafeInteger(response.count) || response.count === null || response.count < 0 || response.count > 10000) throw new Error('The complete caseload could not be loaded. Refresh or contact your manager.');
    if (expected !== null && expected !== response.count) throw new Error('Records changed while loading. Refresh and try again.');
    expected = response.count;
    for (const row of response.data) {
      if (!row || typeof row !== 'object' || typeof row[key] !== 'string' || seen.has(row[key])) throw new Error('The complete caseload could not be verified. Refresh and try again.');
      seen.add(row[key]); result.push(row);
    }
    if (result.length === expected) return result;
    if (!response.data.length || result.length > expected) break;
  }
  throw new Error('The complete caseload could not be loaded. Refresh and try again.');
}

// Small dependency-free OOXML workbook. Every value is an inline text cell, never a formula.
const xml = (value: string) => value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const encoder = new TextEncoder();
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipStored(files: Array<[string, string]>) {
  const locals: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  for (const [name, text] of files) {
    const filename = encoder.encode(name), body = encoder.encode(text), crc = crc32(body);
    const local = new Uint8Array(30 + filename.length + body.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true); l.setUint16(12, 33, true);
    l.setUint32(14, crc, true); l.setUint32(18, body.length, true); l.setUint32(22, body.length, true); l.setUint16(26, filename.length, true);
    local.set(filename, 30); local.set(body, 30 + filename.length); locals.push(local);
    const entry = new Uint8Array(46 + filename.length), c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(14, 33, true);
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, body.length, true); c.setUint16(28, filename.length, true); c.setUint32(42, offset, true);
    entry.set(filename, 46); central.push(entry); offset += local.length;
  }
  const size = central.reduce((sum, entry) => sum + entry.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + 22); let cursor = 0;
  for (const entry of [...locals, ...central, end]) { result.set(entry, cursor); cursor += entry.length; }
  return result;
}
export function createCaseloadWorkbook(rows: string[][]) {
  if (!rows.length || rows.length > 10000 || rows.some((row) => row.length !== caseloadColumns.length || row.some((value) => typeof value !== 'string' || value.length > 32767))) throw new Error('No complete caseload is available to export.');
  if (rows.reduce((total, row) => total + row.reduce((sum, value) => sum + value.length, 0), 0) > 4000000) throw new Error('Export is too large. Filter the caseload and try again.');
  const table = [caseloadColumns, ...rows];
  const sheet = `${header}<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="8" width="28" customWidth="1"/></cols><sheetData>${table.map((row, index) => `<row r="${index + 1}">${row.map((value, column) => `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:H${table.length}"/></worksheet>`;
  return zipStored([
    ['[Content_Types].xml', `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${header}<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Caseload" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}
export function downloadCaseloadWorkbook(rows: string[][]) {
  const bytes = createCaseloadWorkbook(rows);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `REV-caseload-${new Date().toISOString().slice(0, 10)}.xlsx`;
  try { document.body.appendChild(anchor); anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
}
