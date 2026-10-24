import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const appRoot = fileURLToPath(new URL('../', import.meta.url));

// Both runners use .test.* names. Classify their imports rather than silently
// dropping whole directories, which also contain Vitest tests.
export function discoverTestFiles(root = appRoot) {
  const suites = { vitest: [], node: [] };
  function visit(relative) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
        const source = readFileSync(join(root, path), 'utf8');
        const vitest = /\b(?:from|import)\s*['"]vitest['"]/.test(source);
        const node = /\b(?:from|import)\s*['"]node:test['"]/.test(source);
        if (vitest === node) throw new Error(`Unknown or mixed test runner: ${path}`);
        suites[vitest ? 'vitest' : 'node'].push(path);
      }
    }
  }
  visit('src/tests');
  visit('supabase/functions');
  suites.vitest.sort();
  suites.node.sort();
  return suites;
}
