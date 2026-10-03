/**
 * `frontmcp dev --stdio` serves an MCP client end to end (#679).
 *
 * Found on 1.8.7:
 *   - HTTP loopback: the bridge pinned a session id the server never issued, so
 *     the request after `initialize` failed with `dev_server_unreachable`
 *     (`forward_failed`); without a matching `PORT` even `initialize` failed.
 *   - `--serve`: the server exited 0 during boot (the IPC channel stopped at npx)
 *     and every request answered `dev_server_unreachable` (`degraded`).
 *
 * Each case drives the compiled CLI over stdin/stdout like an MCP client.
 */

import * as path from 'node:path';

import { readFile, rm, writeFile } from '@frontmcp/utils';

import {
  createScratchProject,
  freePort,
  helloServerFiles,
  helloToolSource,
  StdioBridgeClient,
  toolText,
  waitFor,
} from './helpers/dev-cli';

const TEST_TIMEOUT = 120_000;

describe('frontmcp dev --stdio (#679)', () => {
  let projectDir: string;
  let client: StdioBridgeClient | undefined;

  afterEach(async () => {
    const stdoutNoise = client?.stdoutNoise ?? [];
    await client?.close();
    client = undefined;
    if (projectDir) await rm(projectDir, { recursive: true, force: true });
    // stdout is the MCP channel: anything but JSON-RPC there breaks the client.
    expect(stdoutNoise).toEqual([]);
  });

  it(
    'HTTP loopback: serves initialize and tools/call with --port and no PORT in the env',
    async () => {
      projectDir = await createScratchProject('dev-stdio-http', helloServerFiles());
      client = new StdioBridgeClient(projectDir, ['--port', String(await freePort())]);

      const init = await client.initialize();
      expect(init.error).toBeUndefined();
      expect(init.result).toMatchObject({ serverInfo: { name: 'dev-e2e' } });

      const list = await client.request('tools/list');
      expect(list.error).toBeUndefined();
      expect((list.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name)).toEqual(['hello']);

      const call = await client.request('tools/call', { name: 'hello', arguments: { name: 'stdio' } });
      expect(call.error).toBeUndefined();
      expect(toolText(call)).toContain('Hello, stdio!');
    },
    TEST_TIMEOUT,
  );

  it(
    'keeps stdout JSON-RPC only when the project has a .env',
    async () => {
      // The .env notice used to land on stdout, ahead of the JSON-RPC frames.
      projectDir = await createScratchProject('dev-stdio-dotenv', {
        ...helloServerFiles(),
        '.env': 'DEV_STDIO_DOTENV=1\n',
      });
      client = new StdioBridgeClient(projectDir, []);

      expect((await client.initialize()).error).toBeUndefined();
      const call = await client.request('tools/call', { name: 'hello', arguments: { name: 'dotenv' } });
      expect(toolText(call)).toContain('Hello, dotenv!');
      expect(client.stdoutNoise).toEqual([]);
      expect(client.stderr).toContain('loaded 1 environment variable');
    },
    TEST_TIMEOUT,
  );

  it(
    'HTTP loopback: follows a port and path hard-coded in @FrontMcp({ http })',
    async () => {
      const port = await freePort();
      projectDir = await createScratchProject(
        'dev-stdio-decorated',
        helloServerFiles({ http: `{ port: ${port}, entryPath: '/decorated' }` }),
      );
      client = new StdioBridgeClient(projectDir, []);

      expect((await client.initialize()).error).toBeUndefined();
      const call = await client.request('tools/call', { name: 'hello', arguments: { name: 'decorated' } });
      expect(call.error).toBeUndefined();
      expect(toolText(call)).toContain('Hello, decorated!');
    },
    TEST_TIMEOUT,
  );

  it(
    'HTTP loopback: a reload keeps the client connected and serves the new code',
    async () => {
      projectDir = await createScratchProject('dev-stdio-reload', helloServerFiles());
      client = new StdioBridgeClient(projectDir, []);
      const bridge = client;
      expect((await bridge.initialize()).error).toBeUndefined();
      expect(toolText(await bridge.request('tools/call', { name: 'hello', arguments: { name: 'a' } }))).toContain(
        'Hello, a!',
      );

      const toolFile = path.join(projectDir, 'src', 'hello.tool.ts');
      await writeFile(toolFile, helloToolSource('Hi'));
      // The bridge announces the reload once the new child has the client's handshake.
      await waitFor(
        async () => bridge.received.some((m) => m.method === 'notifications/tools/list_changed'),
        60_000,
        'notifications/tools/list_changed after the reload',
      );

      const call = await bridge.request('tools/call', { name: 'hello', arguments: { name: 'b' } });
      expect(call.error).toBeUndefined();
      expect(toolText(call)).toContain('Hi, b!');
      expect(await readFile(toolFile)).toContain('Hi');
    },
    TEST_TIMEOUT,
  );

  it(
    '--serve: serves initialize and tools/call over the IPC channel',
    async () => {
      projectDir = await createScratchProject('dev-stdio-serve', helloServerFiles());
      client = new StdioBridgeClient(projectDir, ['--serve']);

      const init = await client.initialize();
      expect(init.error).toBeUndefined();

      const call = await client.request('tools/call', { name: 'hello', arguments: { name: 'pipe' } });
      expect(call.error).toBeUndefined();
      expect(toolText(call)).toContain('Hello, pipe!');
    },
    TEST_TIMEOUT,
  );

  it(
    'stops the dev server when the client closes stdin',
    async () => {
      projectDir = await createScratchProject('dev-stdio-close', helloServerFiles());
      client = new StdioBridgeClient(projectDir, ['--serve']);
      expect((await client.initialize()).error).toBeUndefined();

      expect(await client.close()).toBe(0);
    },
    TEST_TIMEOUT,
  );
});
