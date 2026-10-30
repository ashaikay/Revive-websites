import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverTestFiles } from '../../scripts/test-files.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'rev-test-discovery-'));
  mkdirSync(join(root, 'src/tests'), { recursive: true });
  mkdirSync(join(root, 'supabase/functions'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const runnerImport = (runner, spacing = ' ') => `import test from${spacing}'${runner}';`;

test('separates runner imports across directories, extensions and minified syntax', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'src/tests/frontend.test.tsx'), runnerImport('vitest'));
  writeFileSync(join(root, 'src/tests/client.test.mjs'), runnerImport('node:test'));
  writeFileSync(join(root, 'supabase/functions/boundary.test.ts'), runnerImport('node:test', ''));
  writeFileSync(join(root, 'supabase/functions/adapter.test.ts'), runnerImport('vitest'));
  writeFileSync(join(root, 'src/tests/helper.ts'), 'not a test');
  assert.deepEqual(discoverTestFiles(root), {
    vitest: ['src/tests/frontend.test.tsx', 'supabase/functions/adapter.test.ts'],
    node: ['src/tests/client.test.mjs', 'supabase/functions/boundary.test.ts'],
  });
});

test('fails visibly for an unclassified test instead of silently excluding it', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'src/tests/unknown.test.ts'), 'export {};');
  assert.throws(() => discoverTestFiles(root), /Unknown or mixed test runner/);
});

test('rejects a file that mixes both runners', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'src/tests/mixed.test.ts'), runnerImport('vitest') + runnerImport('node:test'));
  assert.throws(() => discoverTestFiles(root), /Unknown or mixed test runner/);
});
