/**
 * `frontmcp build --target mcpb --sea` ships a binary that starts (#679).
 *
 * The SEA bundle kept `reflect-metadata` and the FrontMCP runtime external, so
 * `FRONTMCP_STDIO=1 bin/<platform>/<name>` died with
 * `No such built-in module: reflect-metadata` — an SEA binary resolves a bare
 * `require()` against Node's built-ins only — while `frontmcp mcpb validate`
 * called the archive valid.
 *
 * Skipped only on a host without SEA binaries or without npx; any other preflight or build failure fails it.
 */

import { execFileSync, spawn } from 'child_process';
// A streamed binary entry written with an executable mode — @frontmcp/utils
// only writes text.
import { createWriteStream } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { fileExists, mkdir, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { getFrontmcpBin, runFrontmcp } from './helpers/mcpb-build';

const yauzl = require('yauzl') as typeof import('yauzl');

const APP = 'sea-demo';
const PLATFORM = `${process.platform}-${process.arch}`;
/** The binary's name in the archive (`bin/<platform>/<name>`): Windows adds `.exe`. */
const BINARY = process.platform === 'win32' ? `${APP}.exe` : APP;
const SCRATCH_ROOT = path.resolve(__dirname, '..');
/** Hosts `frontmcp build --target mcpb --sea` builds a binary for (MCPB platform keys). */
const SEA_HOSTS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'];

/** Why this host cannot build an SEA binary, or `undefined` when it can; any other preflight failure throws. */
function missingSeaToolchain(): string | undefined {
  if (!SEA_HOSTS.includes(PLATFORM)) return `no SEA binary is built for ${PLATFORM}`;
  try {
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['-y', 'postject', '--help'], {
      stdio: 'pipe',
      timeout: 120_000,
      // Node refuses to spawn a .cmd without a shell.
      shell: process.platform === 'win32',
    });
    return undefined;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'npx is not installed';
    const stderr = String((err as { stderr?: Buffer }).stderr ?? '');
    throw new Error(`the postject preflight failed: ${String(err)}\n${stderr}`, { cause: err });
  }
}

const missingToolchain = missingSeaToolchain();
if (missingToolchain) console.warn(`[e2e:mcpb-sea] skipping: ${missingToolchain}`);
const describeWithSeaToolchain = missingToolchain ? describe.skip : describe;

const FILES: Record<string, string> = {
  'frontmcp.config.js': `module.exports = { name: '${APP}', version: '1.0.0', entry: './src/main.ts', deployments: [{ target: 'mcpb' }] };\n`,
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'es2021',
      module: 'esnext',
      moduleResolution: 'node',
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: 'dist',
      rootDir: 'src',
    },
    include: ['src/**/*'],
  }),
  'src/main.ts': `import 'reflect-metadata';
import { App, FrontMcp, LogLevel, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({ name: 'echo', description: 'Echo', inputSchema: { message: z.string() } })
class EchoTool extends ToolContext {
  async execute(input: { message: string }) {
    return { message: input.message };
  }
}

@App({ id: 'sea', name: 'SEA', tools: [EchoTool] })
class SeaApp {}

@FrontMcp({ info: { name: '${APP}', version: '1.0.0' }, apps: [SeaApp], logging: { level: LogLevel.Warn } })
export default class Server {}
`,
};

function extractEntry(archivePath: string, entryName: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('cannot open archive'));
      zip.readEntry();
      zip.on('entry', (entry) => {
        if (entry.fileName !== entryName) return zip.readEntry();
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return reject(streamErr ?? new Error(`cannot read ${entryName}`));
          const out = createWriteStream(dest, { mode: 0o755 });
          out.on('finish', () => {
            zip.close();
            resolve();
          });
          out.on('error', reject);
          stream.on('error', reject);
          stream.pipe(out);
        });
      });
      zip.on('end', () => reject(new Error(`${entryName} not found`)));
      zip.on('error', reject);
    });
  });
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface StdioSession {
  request(frame: JsonRpcRequest): Promise<{ id: number; result?: unknown; error?: unknown }>;
  notify(method: string): void;
  close(): void;
}

/** Run the binary as an MCP stdio server; `request` resolves with the response carrying its id. */
function openStdio(binary: string, home: string): StdioSession {
  const child = spawn(binary, [], {
    env: { ...process.env, FRONTMCP_STDIO: '1', HOME: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  type Waiter = { resolve: (message: { id: number }) => void; reject: (err: Error) => void };
  const waiters = new Map<number, Waiter>();
  let stdout = '';
  let stderr = '';
  child.stdin.on('error', () => undefined);
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdout.on('data', (chunk: Buffer) => {
    const lines = (stdout + chunk.toString()).split('\n');
    stdout = lines.pop() ?? '';
    for (const line of lines.filter((candidate) => candidate.trim())) {
      const message = JSON.parse(line) as { id?: number };
      if (typeof message.id === 'number') waiters.get(message.id)?.resolve({ ...message, id: message.id });
    }
  });
  child.once('exit', (code) => {
    const exited = new Error(`binary exited with ${String(code)} before answering; stderr:\n${stderr}`);
    for (const waiter of waiters.values()) waiter.reject(exited);
    waiters.clear();
  });
  const write = (frame: object): void => {
    child.stdin.write(`${JSON.stringify(frame)}\n`);
  };
  return {
    request: (frame) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(frame.id);
          reject(new Error(`no response to ${frame.method} within 60s; stderr:\n${stderr}`));
        }, 60_000);
        const settle = (): void => {
          clearTimeout(timer);
          waiters.delete(frame.id);
        };
        waiters.set(frame.id, {
          resolve: (message) => {
            settle();
            resolve(message);
          },
          reject: (err) => {
            settle();
            reject(err);
          },
        });
        write(frame);
      }),
    notify: (method) => write({ jsonrpc: '2.0', method }),
    close: () => child.kill('SIGTERM'),
  };
}

describeWithSeaToolchain('frontmcp build --target mcpb --sea (#679)', () => {
  let projectDir: string;
  let home: string;
  let archive: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-mcpb-sea-'));
    for (const [rel, content] of Object.entries(FILES)) {
      await mkdir(path.dirname(path.join(projectDir, rel)), { recursive: true });
      await writeFile(path.join(projectDir, rel), content);
    }
    home = await mkdtemp(path.join(os.tmpdir(), 'mcpb-sea-home-'));
    archive = path.join(projectDir, 'dist', 'mcpb', `${APP}-1.0.0.mcpb`);
    try {
      execFileSync('node', [getFrontmcpBin(), 'build', '--target', 'mcpb', '--sea'], {
        cwd: projectDir,
        stdio: 'pipe',
        timeout: 240_000,
        env: { ...process.env, NODE_ENV: 'production' },
      });
    } catch (err) {
      const output = err as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(
        `frontmcp build --target mcpb --sea failed:\n${String(output.stdout ?? '')}\n${String(output.stderr ?? err)}`,
        { cause: err },
      );
    }
    if (!(await fileExists(archive))) throw new Error(`the build reported success but wrote no ${archive}`);
  }, 300_000);

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it('the SEA binary in the archive serves MCP over stdio', async () => {
    const binary = path.join(home, BINARY);
    await extractEntry(archive, `bin/${PLATFORM}/${BINARY}`, binary);

    const session = openStdio(binary, home);
    try {
      const initialized = await session.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
      });
      expect(initialized).toMatchObject({ result: { serverInfo: { name: APP } } });

      session.notify('notifications/initialized');
      const call = await session.request({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'echo', arguments: { message: 'from-sea' } },
      });
      expect(call.error).toBeUndefined();
      expect(JSON.stringify(call.result)).toContain('from-sea');
    } finally {
      session.close();
    }
  }, 120_000);

  it('frontmcp mcpb validate accepts the archive', async () => {
    const { exitCode, stdout } = runFrontmcp(['mcpb', 'validate', archive], projectDir);
    expect(stdout).toContain('archive is valid');
    expect(exitCode).toBe(0);
  }, 120_000);
});
