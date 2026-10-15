export interface ParticipantContactDraft {
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  postcode: string;
}
export interface ParticipantContactRecord extends ParticipantContactDraft {
  id: string;
  version: number;
}
export const emptyParticipantContact: ParticipantContactDraft = { phone: '', email: '', addressLine1: '', addressLine2: '', town: '', postcode: '' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = ['phone','email','addressLine1','addressLine2','town','postcode'] as const;
export function normaliseParticipantContact(draft: ParticipantContactDraft): ParticipantContactDraft {
  const result = { ...draft };
  for (const field of fields) result[field] = result[field].trim();
  const postcode = result.postcode.replace(/\s/g, '').toUpperCase();
  result.postcode = postcode ? `${postcode.slice(0, -3)} ${postcode.slice(-3)}` : '';
  return result;
}
export function participantContactError(draft: ParticipantContactDraft): string | null {
  for (const field of fields) {
    const max = field === 'phone' ? 40 : field === 'email' ? 320 : field === 'town' ? 120 : field === 'postcode' ? 8 : 200;
    if (draft[field].length > max || /[\u0000-\u001f\u007f]/.test(draft[field])) return 'Check the contact details before saving.';
  }
  if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) return 'Enter a valid email address.';
  if (draft.postcode && !/^(?:[A-Z]{1,2}[0-9][A-Z0-9]?|GIR) [0-9][A-Z]{2}$/.test(draft.postcode)) return 'Enter a UK postcode, for example B1 1AA.';
  return null;
}
export const participantContactColumns = 'id,workspace_id,programme_id,participant_id,phone,email,address_line_1,address_line_2,town,postcode,version';
export function parseParticipantContact(rows: unknown, workspaceId: string, programmeId: string, participantId: string): ParticipantContactRecord | null {
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('Contact details could not be loaded.');
  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !uuid.test(row.id) || row.workspace_id !== workspaceId || row.programme_id !== programmeId || row.participant_id !== participantId || !Number.isSafeInteger(row.version) || (row.version as number) < 1) throw new Error('Contact details could not be loaded.');
  const draft: ParticipantContactDraft = { ...emptyParticipantContact };
  const columns = ['phone','email','address_line_1','address_line_2','town','postcode'];
  fields.forEach((field, index) => {
    const value = row[columns[index]];
    if (value !== null && typeof value !== 'string') throw new Error('Contact details could not be loaded.');
    draft[field] = value as string | null ?? '';
  });
  if (participantContactError(draft)) throw new Error('Contact details could not be loaded.');
  return { ...draft, id: row.id, version: row.version as number };
}
