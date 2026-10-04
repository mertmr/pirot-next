import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
// Only the dedicated disposable browser state is reset; normal local D1 remains intact.
// This path must stay in sync with PIROT_E2E handling in vite.config.ts.
const state = resolve('.wrangler/e2e');
rmSync(state, { recursive: true, force: true });
const setup = spawnSync('bunx', ['--no-install', 'wrangler', 'd1', 'migrations', 'apply', 'DIRECTORY', '--local', '--persist-to', state], {
  stdio: 'inherit',
});
if (setup.status !== 0) process.exit(setup.status ?? 1);
const server = spawn('bunx', ['--no-install', 'vite', '--host', '127.0.0.1', '--port', '9071', '--strictPort'], {
  stdio: 'inherit',
  env: { ...process.env, PIROT_E2E: 'true' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', code => process.exit(code ?? 1));
