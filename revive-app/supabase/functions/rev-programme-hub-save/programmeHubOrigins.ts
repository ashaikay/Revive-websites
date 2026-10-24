// Add a reviewed preview without replacing any existing production origins.
export function programmeHubAllowedOrigins(read: (name: string) => string | undefined) {
  const primary = read('REV_PROGRAMME_HUB_ALLOWED_ORIGINS')
    ?? read('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN') ?? 'http://localhost:5180';
  const additional = read('REV_PROGRAMME_HUB_ADDITIONAL_ALLOWED_ORIGINS');
  return additional === undefined ? primary : `${primary},${additional}`;
}
