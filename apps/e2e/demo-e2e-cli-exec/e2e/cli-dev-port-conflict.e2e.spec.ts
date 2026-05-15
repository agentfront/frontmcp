// apps/e2e/demo-e2e-cli-exec/e2e/cli-dev-port-conflict.e2e.spec.ts
//
// End-to-end tests for `frontmcp dev` EADDRINUSE handling (issue #398).
//
// These exercise the COMPILED `frontmcp` developer-tool CLI bin (the same
// `libs/cli/dist/src/core/cli.js` that users hit via `npx frontmcp dev`) in
// a real subprocess, against a real held TCP port. They verify the
// user-visible surface end-to-end:
//
//   1. With a busy port and no `--auto-port` flag, the CLI exits with code 1
//      and writes a structured "Port <n> is already in use" message to stderr.
//   2. With `--auto-port`, the CLI logs the next free port it walked to and
//      proceeds to spawn the dev pipeline.
//
// `runFrontmcpCli` (sync) is reused for the busy-port-exit case because the
// child exits promptly. The auto-port case needs a long-running spawn with a
// kill timeout because the child then proceeds to start `tsx --watch`.

import { spawn } from 'node:child_process';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { mkdtemp, writeFile } from '@frontmcp/utils';

import { runFrontmcpCli } from './helpers/exec-cli';

const HOST = '127.0.0.1';
const TEST_TIMEOUT = 60_000;
const ROOT_DIR = path.resolve(__dirname, '../../../..');
const FRONTMCP_BIN = path.join(ROOT_DIR, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');

function holdPort(): Promise<{ port: number; release: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ port: 0, host: HOST, exclusive: true }, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not determine ephemeral port'));
        return;
      }
      resolve({
        port: addr.port,
        release: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

async function makeFakeEntry(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fix-398-e2e-'));
  const file = path.join(dir, 'main.ts');
  await writeFile(file, 'setTimeout(() => {}, 60_000);\n', 'utf-8');
  return file;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('frontmcp dev — port conflict end-to-end (issue #398)', () => {
  it(
    'exits with code 1 and prints "Port <n> is already in use" on stderr when the port is busy',
    async () => {
      const probe = await holdPort();
      const entry = await makeFakeEntry();
      try {
        const { exitCode, stderr } = runFrontmcpCli(
          ['dev', '--port', String(probe.port), '--entry', entry],
          // Force PORT empty so the pre-flight probe uses --port, not the host env.
          { PORT: '' },
        );

        expect(exitCode).toBe(1);
        const cleaned = stripAnsi(stderr);
        expect(cleaned).toMatch(new RegExp(`Port ${probe.port} is already in use`));
        expect(cleaned).toMatch(/--port/);
        expect(cleaned).toMatch(/--auto-port/);
      } finally {
        await probe.release();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'with --show-conflict, includes a hint about the holder of the port',
    async () => {
      const probe = await holdPort();
      const entry = await makeFakeEntry();
      try {
        const { exitCode, stderr } = runFrontmcpCli(
          ['dev', '--port', String(probe.port), '--entry', entry, '--show-conflict'],
          { PORT: '' },
        );

        expect(exitCode).toBe(1);
        const cleaned = stripAnsi(stderr);
        // Either lsof identified the holder OR we surfaced a clean fallback.
        expect(cleaned).toMatch(/Holder of \d+|could not identify the holder/);
      } finally {
        await probe.release();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'auto-picks the next free port when --auto-port is set against a busy port',
    async () => {
      const probe = await holdPort();
      const entry = await makeFakeEntry();
      try {
        const result = await new Promise<{ announcedPort: number; matched: boolean; raw: string }>(
          (resolve, reject) => {
            const child = spawn(
              process.execPath,
              [FRONTMCP_BIN, 'dev', '--port', String(probe.port), '--auto-port', '--entry', entry],
              {
                cwd: ROOT_DIR,
                env: { ...process.env, NODE_ENV: 'test', PORT: '' },
                stdio: ['ignore', 'pipe', 'pipe'],
              },
            );
            let buf = '';
            let matched = false;
            const timer = setTimeout(() => {
              child.kill('SIGKILL');
              reject(new Error(`auto-port message not seen in stdout+stderr; buffered:\n${buf}`));
            }, TEST_TIMEOUT - 5_000);

            const onChunk = (d: Buffer) => {
              buf += d.toString('utf-8');
              const cleaned = stripAnsi(buf);
              const m = cleaned.match(/auto-picked (\d+)/);
              if (m) {
                matched = true;
                clearTimeout(timer);
                child.kill('SIGINT');
                // Drain remaining output so the close handler fires cleanly.
                child.once('close', () => resolve({ announcedPort: Number(m[1]), matched: true, raw: cleaned }));
              }
            };
            child.stdout?.on('data', onChunk);
            child.stderr?.on('data', onChunk);
            child.once('error', (err) => {
              clearTimeout(timer);
              reject(err);
            });
            // Fail fast if the child exits before emitting "auto-picked"
            // — without this, the test sat blocked until TEST_TIMEOUT
            // (CodeRabbit on PR #421). The matched-branch's own
            // child.once('close', ...) still fires for the happy path.
            child.once('close', (code, signal) => {
              if (!matched) {
                clearTimeout(timer);
                reject(
                  new Error(
                    `child exited before auto-port message (code=${String(code)}, signal=${String(signal)}); buffered:\n${stripAnsi(buf)}`,
                  ),
                );
              }
            });
          },
        );

        expect(result.matched).toBe(true);
        expect(result.announcedPort).toBeGreaterThan(probe.port);
      } finally {
        await probe.release();
      }
    },
    TEST_TIMEOUT,
  );
});
