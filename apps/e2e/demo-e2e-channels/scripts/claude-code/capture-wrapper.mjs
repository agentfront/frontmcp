/**
 * Runs the demo channel server over stdio and logs every line that passes between it and the client.
 * With CAPTURE_EMIT_EVENT=1, it also has the server emit one channel event once the session is initialized.
 *
 * Usage: node capture-wrapper.mjs <log file>
 */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EMIT_REQUEST_ID = 'capture-emit-1';
const EMIT_DELAY_MS = 6000;
const EVENT_MESSAGE = 'FrontMCP channel check. No action needed; reply with ok only.';

const [logFile] = process.argv.slice(2);
if (!logFile) {
  console.error('Usage: node capture-wrapper.mjs <log file>');
  process.exit(2);
}

const appDir = fileURLToPath(new URL('../..', import.meta.url));
const emitsEvent = process.env.CAPTURE_EMIT_EVENT === '1';
const startedAt = Date.now();

/** Appends one line to the log: the time since the start, the direction, and the text. */
function record(direction, text) {
  appendFileSync(logFile, `${Date.now() - startedAt}ms ${direction} ${text}\n`);
}

/** Returns a `data` handler that calls `onLine` with each complete, non-empty line. */
function lineReader(onLine) {
  let pending = '';
  return (chunk) => {
    pending += chunk.toString('utf8');
    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line) onLine(line);
      newline = pending.indexOf('\n');
    }
  };
}

/** Reads the JSON-RPC message on a line; a line that is not JSON reads as an empty message. */
function messageOf(line) {
  try {
    return JSON.parse(line);
  } catch {
    return {};
  }
}

/** Has the server emit an `app:error` event, which its `error-alerts` channel sends to the session. */
function emitChannelEvent() {
  const request = {
    jsonrpc: '2.0',
    id: EMIT_REQUEST_ID,
    method: 'tools/call',
    params: {
      name: 'emit-app-event',
      arguments: { event: 'app:error', payload: { level: 'info', message: EVENT_MESSAGE } },
    },
  };
  const line = JSON.stringify(request);
  record('WRAPPER->SERVER', line);
  server.stdin.write(`${line}\n`);
}

const server = spawn(process.execPath, ['--import', 'tsx', 'src/stdio-entrypoint.ts'], {
  cwd: appDir,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let emitScheduled = false;

process.stdin.on(
  'data',
  lineReader((line) => {
    record('CLIENT->SERVER', line);
    server.stdin.write(`${line}\n`);
    if (emitsEvent && !emitScheduled && messageOf(line).method === 'notifications/initialized') {
      emitScheduled = true;
      setTimeout(emitChannelEvent, EMIT_DELAY_MS);
    }
  }),
);
process.stdin.on('end', () => server.stdin.end());

server.stdout.on(
  'data',
  lineReader((line) => {
    record('SERVER->CLIENT', line);
    const answersWrapper = messageOf(line).id === EMIT_REQUEST_ID;
    if (!answersWrapper) process.stdout.write(`${line}\n`);
  }),
);
server.stderr.on('data', (chunk) => record('SERVER-STDERR', chunk.toString('utf8').trim()));
server.on('exit', (code) => {
  record('EXIT', `server exited ${code}`);
  process.exit(code ?? 0);
});
