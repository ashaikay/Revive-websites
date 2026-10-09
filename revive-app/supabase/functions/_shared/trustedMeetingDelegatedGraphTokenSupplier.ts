import type { OAuthTokenConfiguration } from '../rev-calendar-oauth-complete/calendarOAuthCompletion.ts';
import { refreshCalendarDiscoveryToken } from '../rev-calendar-discover/calendarDiscoveryWorkflow.ts';
import type { TrustedMeetingExecutionSnapshot } from './trustedMeetingExecutionReadModel.ts';

export interface TrustedMeetingCredentialClient {
  rpc(name: 'load_rev_meeting_calendar_credential', args: {
    target_execution_id: string;
  }): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'rotate_rev_meeting_calendar_credential', args: {
    target_execution_id: string;
    expected_revision: number;
    target_refresh_token: string;
  }): Promise<{ data: unknown; error: unknown }>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = /^[0-9a-f]{64}$/;
const unavailable = () => new Error('Reserved Outlook credential unavailable.');
function row(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !data[0] ||
    typeof data[0] !== 'object' || Array.isArray(data[0])) throw unavailable();
  return data[0] as Record<string, unknown>;
}

function matchesReservation(value: Record<string, unknown>, snapshot: TrustedMeetingExecutionSnapshot): boolean {
  return value.execution_id === snapshot.executionId &&
    value.workspace_id === snapshot.workspaceId &&
    value.calendar_id === snapshot.calendarId &&
    value.connection_id === snapshot.connectionId &&
    value.credential_reference === snapshot.credentialReference &&
    value.credential_revision === snapshot.credentialRevision &&
    value.consent_version === snapshot.consentVersion &&
    value.provider_account_reference === snapshot.calendarReference &&
    value.provider_calendar_reference === snapshot.providerCalendarReference &&
    value.timezone === snapshot.timezone &&
    value.workspace_binding_version === snapshot.bindingVersion &&
    value.target_fingerprint === snapshot.targetFingerprint &&
    typeof value.consent_by_user_id === 'string' && uuid.test(value.consent_by_user_id) &&
    typeof value.refresh_token === 'string' && value.refresh_token.trim().length > 0 &&
    value.refresh_token.length <= 32768;
}

export function createTrustedMeetingDelegatedGraphTokenSupplier(
  client: TrustedMeetingCredentialClient,
  getOAuthConfig: () => OAuthTokenConfiguration,
  fetchImpl: typeof fetch = fetch,
) {
  return async (snapshot: TrustedMeetingExecutionSnapshot): Promise<string> => {
    if (!uuid.test(snapshot.executionId) || !uuid.test(snapshot.workspaceId) ||
      !uuid.test(snapshot.calendarId) || !uuid.test(snapshot.connectionId) ||
      !uuid.test(snapshot.credentialReference) || !Number.isSafeInteger(snapshot.credentialRevision) ||
      snapshot.credentialRevision < 1 || !Number.isSafeInteger(snapshot.consentVersion) ||
      snapshot.consentVersion < 1 || !Number.isSafeInteger(snapshot.bindingVersion) ||
      snapshot.bindingVersion < 1 || !sha256.test(snapshot.targetFingerprint)) throw unavailable();

    const loaded = await client.rpc('load_rev_meeting_calendar_credential', {
      target_execution_id: snapshot.executionId,
    });
    if (loaded.error) throw unavailable();
    const credential = row(loaded.data);
    if (!matchesReservation(credential, snapshot)) throw unavailable();

    const refreshed = await refreshCalendarDiscoveryToken(
      getOAuthConfig(),
      credential.refresh_token as string,
      fetchImpl,
      'write',
    );
    const rotated = await client.rpc('rotate_rev_meeting_calendar_credential', {
      target_execution_id: snapshot.executionId,
      expected_revision: snapshot.credentialRevision,
      target_refresh_token: refreshed.refreshToken,
    });
    if (rotated.error) throw unavailable();
    const saved = row(rotated.data);
    if (saved.credential_reference !== snapshot.credentialReference ||
      saved.revision !== snapshot.credentialRevision + 1) throw unavailable();
    return refreshed.accessToken;
  };
}
