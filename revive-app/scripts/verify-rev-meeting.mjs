import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const shared = 'supabase/functions/_shared/';
const tests = [
  'meetingEventExecutionBoundary.test.ts',
  'meetingReservationAuthority.test.ts',
  'trustedMeetingBindingGuard.test.ts',
  'atomicMeetingReservationAuthority.test.ts',
  'disabledMeetingExecutionService.test.ts',
  'meetingExecutionServerDependencies.test.ts',
  'meetingExecutionHttpBoundary.test.ts',
  'trustedMeetingProviderAttempt.test.ts',
  'meetingProviderWorkflow.test.ts',
  'trustedMeetingProviderComposition.test.ts',
  'trustedMeetingGraphTokenSupplier.test.ts',
  'trustedMeetingProviderServer.test.ts',
  'meetingProviderHttpService.test.ts',
].map(name => shared + name);


function run(label, executable, args, options = {}) {
  console.log(`\n${label}`);
  const result = spawnSync(executable, args, { cwd: appRoot, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('REV meeting server boundary tests', process.execPath,
  ['--experimental-strip-types', '--test', ...tests]);
run('REV frontend typecheck and build', process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'build'], { shell: process.platform === 'win32' });
console.log('\nREV_MEETING_LOCAL_VERIFY=PASS');
