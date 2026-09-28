const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveMeetingProviderLiveWorkspace(
  configuredWorkspaceId: string | undefined,
  trustedWorkspaceId: string | undefined,
): string | null {
  const configured = configuredWorkspaceId?.trim().toLowerCase() ?? '';
  const trusted = trustedWorkspaceId?.trim().toLowerCase() ?? '';
  return uuid.test(configured) && configured === trusted ? configured : null;
}