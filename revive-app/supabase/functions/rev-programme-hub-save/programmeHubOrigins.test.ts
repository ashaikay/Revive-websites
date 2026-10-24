import test from 'node:test';
import assert from 'node:assert/strict';
import { programmeHubAllowedOrigins } from './programmeHubOrigins.ts';
import { handleProgrammeHubSave, type ProgrammeHubDependencies } from './programmeHubBoundary.ts';

test('preview origin configuration preserves production settings and exact matching', async () => {
  const env: Record<string,string> = {
    REV_PROGRAMME_HUB_ALLOWED_ORIGINS: 'https://rev11.netlify.app',
    REV_PROGRAMME_HUB_ADDITIONAL_ALLOWED_ORIGINS: 'https://deploy-preview-4--rev11.netlify.app',
  };
  const fail = async (): Promise<never> => { throw Error('Preflight must not call authority'); };
  const deps: ProgrammeHubDependencies = { allowedOrigin: programmeHubAllowedOrigins(name => env[name]),
    getUserId: fail, canWriteWorkspace: fail, save: fail };
  for (const origin of ['https://rev11.netlify.app', 'https://deploy-preview-4--rev11.netlify.app',
    'https://deploy-preview-5--rev11.netlify.app', 'https://deploy-preview-4--rev11.netlify.app.attacker.test']) {
    const allowed = Object.values(env).includes(origin);
    const response = await handleProgrammeHubSave(new Request('https://example.test', {
      method: 'OPTIONS', headers: { Origin: origin },
    }), deps);
    assert.equal(response.status, allowed ? 204 : 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowed ? origin : null);
  }
});
test('legacy fallback and explicit empty origin configuration are retained', () => {
  const env: Record<string,string> = {REV_CALENDAR_OAUTH_ALLOWED_ORIGIN: 'https://legacy.example'};
  assert.equal(programmeHubAllowedOrigins(name => env[name]), 'https://legacy.example');
  env.REV_PROGRAMME_HUB_ALLOWED_ORIGINS = '';
  assert.equal(programmeHubAllowedOrigins(name => env[name]), '');
  assert.equal(programmeHubAllowedOrigins(() => undefined), 'http://localhost:5180');
});
