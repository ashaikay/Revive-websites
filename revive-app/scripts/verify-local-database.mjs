import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localValidationEnvironment } from './local-supabase-settings.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Capture status privately: it includes credentials generated for the local stack.
const statusCommand = process.platform === 'win32'
  ? ['cmd.exe', ['/d', '/s', '/c', 'npx --yes supabase@2.117.0 status -o env']]
  : ['npx', ['--yes', 'supabase@2.117.0', 'status', '-o', 'env']];
const status = spawnSync(statusCommand[0], statusCommand[1], { cwd: root, encoding: 'utf8' });
if (status.error || status.status !== 0) throw new Error('Start the isolated local Supabase stack before running database checks.');
const env = localValidationEnvironment(status.stdout);
const logs = join(root, 'local-db-validation.local');
mkdirSync(logs, { recursive: true });
const results = [];

function run(name, executable, args, input) {
  const started = Date.now();
  const result = spawnSync(executable, args, {
    cwd: root, env, input, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
  });
  let output = (result.stdout ?? '') + (result.stderr ?? '');
  for (const value of [env.REV_LOCAL_SUPABASE_ANON_KEY, env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY]) {
    output = output.replaceAll(value, '[REDACTED]');
  }
  writeFileSync(join(logs, `${name}.log`), output);
  const passed = !result.error && result.status === 0;
  results.push({ name, passed, exitCode: result.status, seconds: (Date.now() - started) / 1000 });
  console.log(`${name}=${passed ? 'PASS' : 'FAIL'}`);
  writeFileSync(join(logs, 'summary.json'), JSON.stringify(results, null, 2) + '\n');
}

const sqlDirectory = join(root, 'supabase/tests');
const sqlFiles = readdirSync(sqlDirectory).filter(name => name.endsWith('.sql')).sort();
if (!sqlFiles.length) throw new Error('No local SQL tests found.');
for (const name of sqlFiles) {
  run(name, 'docker', ['exec', '-i', 'supabase_db_revive-app', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], readFileSync(join(sqlDirectory, name), 'utf8'));
}
for (const name of [
  'programme_hub', 'programme_employer_engagement', 'workspace_team', 'workspace_module_access',
  'scheduling_management', 'worker_records', 'worker_patterns', 'worker_unavailability',
  'annual_leave_stage1', 'annual_leave_stage2', 'scheduling_jobs', 'scheduling_daily_sessions',
  'scheduling_assignments', 'scheduling_job_import', 'phase5e_meeting_reminder_delivery',
]) {
  run(name, process.execPath, ['--experimental-strip-types', `src/tests/${name}_local_validation.mjs`]);
}
const failures = results.filter(result => !result.passed).length;
console.log(`Local database validation: ${results.length - failures}/${results.length} suites passed. Logs: local-db-validation.local/`);
process.exitCode = failures ? 1 : 0;
