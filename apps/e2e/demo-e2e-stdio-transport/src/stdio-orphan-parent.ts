/**
 * A client stand-in that can die while the stdio server's stdin stays open: a relay that outlives it forwards
 * this process's stdin to the server. Writes `{ server, relay }` pids to `SERVER_PID_FILE`.
 */
import { getSpawnFn, writeFile } from '@frontmcp/utils';

const RELAY = 'process.stdin.on("data", (chunk) => process.stdout.write(chunk)); setInterval(() => undefined, 60_000);';

const spawn = getSpawnFn();
const relay = spawn(process.execPath, ['-e', RELAY], { stdio: ['inherit', 'pipe', 'ignore'] });
const server = spawn(process.execPath, ['--import', 'tsx', 'src/stdio-orphan-entrypoint.ts'], {
  stdio: [relay.stdout, 'inherit', 'inherit'],
});
relay.stdout?.destroy();
void writeFile(
  process.env['SERVER_PID_FILE'] ?? 'server.pid',
  JSON.stringify({ server: server.pid, relay: relay.pid }),
);
setInterval(() => undefined, 60_000);
