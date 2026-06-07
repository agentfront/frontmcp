// apps/e2e/demo-e2e-cli-exec/e2e/cli-dev-http-path.e2e.spec.ts
//
// End-to-end test for `frontmcp dev` honoring `transport.http.path` (issue #446).
//
// The bug: `frontmcp dev` served the MCP endpoint at `/`, ignoring the configured
// `transport.http.path` — so the generated `clients.*.url` (which DOES use that
// path) 404'd. The fix propagates `transport.http.path` to the spawned server as
// `FRONTMCP_HTTP_ENTRY_PATH`, which the SDK's `httpOptionsSchema.entryPath`
// default reads (mirroring how the resolved port is passed via `PORT`).
//
// This drives the COMPILED `frontmcp` dev-tool bin in a real subprocess against a
// throwaway project whose `frontmcp.config.js` sets `transport.http.path`, and a
// fake entry that prints the env the CLI injected. We assert the child received
// `FRONTMCP_HTTP_ENTRY_PATH=/mcp`. (The SDK end — that this env actually moves the
// mounted endpoint — is covered by
// apps/e2e/demo-e2e-standalone/e2e/entry-path-env.e2e.spec.ts.)

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { mkdtemp, writeFile } from '@frontmcp/utils';

const TEST_TIMEOUT = 60_000;
const ROOT_DIR = path.resolve(__dirname, '../../../..');
const FRONTMCP_BIN = path.join(ROOT_DIR, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Spin up a throwaway project: a `frontmcp.config.js` that sets
 * `transport.http.path`, plus a fake entry that echoes the injected env and then
 * idles so the dev pipeline stays alive long enough to read it.
 */
async function makeProject(httpPath: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fix-446-e2e-'));
  await writeFile(
    path.join(dir, 'main.ts'),
    `console.error('FMCP_ENTRY_PATH=[' + (process.env.FRONTMCP_HTTP_ENTRY_PATH ?? '<unset>') + ']');\nsetTimeout(() => {}, 60_000);\n`,
    'utf-8',
  );
  await writeFile(
    path.join(dir, 'frontmcp.config.js'),
    `module.exports = { name: 'fix446', version: '1.0.0', entry: './main.ts', deployments: [{ target: 'node' }], transport: { default: 'http', http: { port: 3000, path: '${httpPath}' } } };\n`,
    'utf-8',
  );
  return dir;
}

describe('frontmcp dev — honors transport.http.path (issue #446)', () => {
  it(
    'propagates transport.http.path to the spawned server as FRONTMCP_HTTP_ENTRY_PATH',
    async () => {
      const dir = await makeProject('/mcp');

      const result = await new Promise<{ matched: boolean; raw: string }>((resolve, reject) => {
        // --auto-port so a busy 3000 on the test host walks to a free port
        // instead of failing the pre-flight check (the fake entry never binds).
        const child = spawn(process.execPath, [FRONTMCP_BIN, 'dev', '--auto-port'], {
          cwd: dir,
          env: { ...process.env, NODE_ENV: 'test', PORT: '' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let buf = '';
        let matched = false;
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`FRONTMCP_HTTP_ENTRY_PATH marker not seen; buffered:\n${stripAnsi(buf)}`));
        }, TEST_TIMEOUT - 5_000);

        const onChunk = (d: Buffer) => {
          buf += d.toString('utf-8');
          if (/FMCP_ENTRY_PATH=\[\/mcp\]/.test(stripAnsi(buf))) {
            matched = true;
            clearTimeout(timer);
            child.kill('SIGINT');
            child.once('close', () => resolve({ matched: true, raw: stripAnsi(buf) }));
          }
        };
        child.stdout?.on('data', onChunk);
        child.stderr?.on('data', onChunk);
        child.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        // Fail fast if the child exits before emitting the marker.
        child.once('close', (code, signal) => {
          if (!matched) {
            clearTimeout(timer);
            reject(
              new Error(
                `dev exited before the marker (code=${String(code)}, signal=${String(signal)}); buffered:\n${stripAnsi(buf)}`,
              ),
            );
          }
        });
      });

      expect(result.matched).toBe(true);
      // Guard against the pre-fix behavior leaking through (env unset → '<unset>').
      expect(result.raw).not.toMatch(/FMCP_ENTRY_PATH=\[<unset>\]/);
    },
    TEST_TIMEOUT,
  );
});
