const developmentOrigins = new Set([
  'http://localhost:5180',
  'http://127.0.0.1:5180',
]);

export function resolveAnnualLeaveOrigin(requestOrigin: string | null, configuredOrigin?: string) {
  if (!requestOrigin || !configuredOrigin) return null;
  if (requestOrigin === configuredOrigin) return requestOrigin;
  if (developmentOrigins.has(configuredOrigin) && developmentOrigins.has(requestOrigin)) return requestOrigin;
  return null;
}
