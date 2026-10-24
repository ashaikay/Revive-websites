import test from 'node:test';
import assert from 'node:assert/strict';
import { localValidationEnvironment } from '../../scripts/local-supabase-settings.mjs';

const localStatus = ['API_URL="http://127.0.0.1:55321"', 'ANON_KEY="fixture-anon"', 'SERVICE_ROLE_KEY="fixture-service"'].join('\n');

test('uses local CLI bindings and replaces inherited harness URL and key aliases', () => {
  const env = localValidationEnvironment(localStatus, {
    REV_LOCAL_SUPABASE_URL: 'https://example.invalid',
    REV_LOCAL_SUPABASE_SERVICE_KEY: 'stale-fixture', OTHER: 'preserved',
  });
  assert.equal(env.REV_LOCAL_SUPABASE_URL, 'http://127.0.0.1:55321');
  assert.equal(env.REV_LOCAL_SUPABASE_ANON_KEY, 'fixture-anon');
  assert.equal(env.REV_LOCAL_SUPABASE_SERVICE_KEY, 'fixture-service');
  assert.equal(env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY, 'fixture-service');
  assert.equal(env.OTHER, 'preserved');
});

test('refuses hosted, absent, or wrong-port endpoints before running checks', () => {
  for (const url of ['https://example.invalid', 'http://127.0.0.1:54321', '']) {
    assert.throws(() => localValidationEnvironment(localStatus.replace('http://127.0.0.1:55321', url)), /isolated local API/);
  }
});

test('requires both local key bindings without exposing their values in errors', () => {
  for (const line of ['ANON_KEY="fixture-anon"', 'SERVICE_ROLE_KEY="fixture-service"']) {
    assert.throws(() => localValidationEnvironment(localStatus.replace(line, '')), /bindings are missing/);
  }
});
