export interface ApprovedEmailFingerprintInput {
  workspaceId: string;
  actionId: string;
  actionVersion: number;
  recipient: string;
  subject: string;
  body: string;
}

export async function fingerprintApprovedEmail(
  input: ApprovedEmailFingerprintInput,
): Promise<string> {
  const material = JSON.stringify({
    workspaceId: input.workspaceId,
    actionId: input.actionId,
    actionVersion: input.actionVersion,
    recipient: input.recipient.trim().toLowerCase(),
    subject: input.subject,
    body: input.body,
  });

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(material),
  );

  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
