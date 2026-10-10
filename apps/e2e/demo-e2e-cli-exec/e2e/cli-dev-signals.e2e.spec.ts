/**
 * `kill <frontmcp dev pid>` stops the dev server (#679).
 *
 * The server is a grandchild of `frontmcp dev` (tsx → node). SIGTERM or SIGINT
 * sent to the `frontmcp dev` process alone used to exit 0 while the server kept
 * listening; only Ctrl+C (which signals the whole terminal process group)
 * worked.
 *
 * Windows (#731, run by the `windows-latest` CI job): `frontmcp dev` used to
 * die at startup with `spawn EINVAL` (a shell-less `npx.cmd`). Node cannot
 * deliver a catchable signal to another process there — `kill()` is
 * `TerminateProcess`, so no handler runs and the exit code is not 0. What must
 * hold is that the server goes with it: with tsx and tsc spawned directly
 * (no `cmd.exe` shim in between), each process's kill-on-close job object
 * takes its children down.
 */

import { spawn } from 'node:child_process';

import {
  createScratchProject,
  envWithoutPort,
  freePort,
  FRONTMCP_BIN,
  isListening,
  removeScratchProject,
  waitFor,
} from './helpers/dev-cli';

const TEST_TIMEOUT = 120_000;
const IS_WINDOWS = process.platform === 'win32';

const SERVER = `import * as net from 'node:net';

const server = net.createServer((socket) => socket.end());
server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening on', process.env.PORT));
`;

describe('frontmcp dev — shutdown signals (#679)', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createScratchProject('dev-signals', {
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, types: ['node'] }, include: ['src/**/*'] }),
      'src/main.ts': SERVER,
    });
  });

  afterAll(async () => {
    await removeScratchProject(projectDir);
  });

  it.each(['SIGTERM', 'SIGINT'] as const)(
    '%s to the frontmcp dev process alone stops the server it started',
    async (signal) => {
      const port = await freePort();
      const dev = spawn(process.execPath, [FRONTMCP_BIN, 'dev', '--port', String(port), '--entry', 'src/main.ts'], {
        cwd: projectDir,
        env: envWithoutPort(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      dev.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
      dev.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
      const exited = new Promise<number | null>((resolve) => dev.once('exit', (code) => resolve(code)));

      try {
        await waitFor(() => isListening(port), 60_000, `the dev server on port ${port}`);

        // Signal the CLI process only — not its process group, the way `kill <pid>` does.
        dev.kill(signal);

        if (IS_WINDOWS) {
          await exited;
          await waitFor(async () => !(await isListening(port)), 15_000, `port ${port} to be released`);
        } else {
          expect(await exited).toBe(0);
          expect(await isListening(port)).toBe(false);
        }
        expect(output).not.toContain('EINVAL');
      } catch (err) {
        dev.kill('SIGKILL');
        throw new Error(`${(err as Error).message}\noutput:\n${output}`, { cause: err });
      }
    },
    TEST_TIMEOUT,
  );
});
