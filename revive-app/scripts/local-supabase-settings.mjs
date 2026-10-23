export function localValidationEnvironment(statusOutput, inherited = process.env) {
  const settings = {};
  for (const line of statusOutput.split(/\r?\n/)) {
    const match = /^([A-Z_]+)="([^"]*)"$/.exec(line.trim());
    if (match) settings[match[1]] = match[2];
  }
  const url = 'http://127.0.0.1:55321';
  if (settings.API_URL !== url) throw new Error('Expected the isolated local API at 127.0.0.1:55321. No checks run.');
  if (!settings.ANON_KEY || !settings.SERVICE_ROLE_KEY) throw new Error('Local Supabase test bindings are missing.');
  return {
    ...inherited,
    REV_LOCAL_SUPABASE_URL: url,
    REV_LOCAL_SUPABASE_ANON_KEY: settings.ANON_KEY,
    REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY: settings.SERVICE_ROLE_KEY,
    REV_LOCAL_SUPABASE_SERVICE_KEY: settings.SERVICE_ROLE_KEY,
  };
}
