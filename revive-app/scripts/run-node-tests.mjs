import { spawnSync } from 'node:child_process';
import { appRoot, discoverTestFiles } from './test-files.mjs';

const tests = discoverTestFiles().node;
if (!tests.length) throw new Error('No Node test suites found.');
console.log(`Running ${tests.length} Node test files (two workers).`);
// Use argument arrays, not shell globs, so this also works in Windows PowerShell.
const result = spawnSync(process.execPath, [
  '--experimental-strip-types', '--test', '--test-concurrency=2', ...tests,
], { cwd: appRoot, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
