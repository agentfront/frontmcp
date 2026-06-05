/**
 * E2E: stdio transport binds NO HTTP/TCP port, and runStdio accepts a class.
 *
 * Regression coverage for three linked issues:
 *
 *  - #451 — running over stdio used to ALSO bind 0.0.0.0:3000 (the @FrontMcp
 *           decorator auto-bootstrapped an HTTP server at import time).
 *  - #450 — `FrontMcpInstance.runStdio(MyServerClass)` threw a Zod error
 *           because it only accepted a config object, not a decorated class.
 *  - #448 — the built `node` runner now serves stdio via FRONTMCP_STDIO=1, which
 *           is the same env flag the decorated-class path below exercises.
 *
 * Each case connects a real MCP client over stdio, then asserts that the
 * server's HTTP port is NOT listening — proving stdio mode never opens a socket.
 */

import { join } from 'path';

import { isTcpPortListening, McpClient, McpStdioClientTransport } from '@frontmcp/testing';

// A high, unlikely-used port. If the HTTP server were (wrongly) started, the
// decorator would bind PORT here; in stdio mode nothing should listen on it.
const TEST_PORT = 39917;
const projectPath = join(__dirname, '..');

describe('Stdio Transport — no HTTP port bound (#448, #450, #451)', () => {
  let client: McpClient | null = null;
  let transport: McpStdioClientTransport | null = null;

  afterEach(async () => {
    if (client) {
      try {
        await client.close();
      } catch {
        /* process may have exited */
      }
      client = null;
    }
    if (transport) {
      try {
        await transport.close();
      } catch {
        /* process may have exited */
      }
      transport = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  async function connect(entry: string, extraEnv: Record<string, string> = {}): Promise<void> {
    transport = new McpStdioClientTransport({
      command: 'npx',
      args: ['tsx', join(projectPath, entry)],
      env: { ...process.env, PORT: String(TEST_PORT), ...extraEnv } as Record<string, string>,
      cwd: projectPath,
    });
    client = new McpClient({ name: 'stdio-noport-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
  }

  // ── #451 / #448 — decorated class served over stdio via FRONTMCP_STDIO=1 ──
  // This mirrors what the built `node dist/<name> --stdio` runner does: it sets
  // FRONTMCP_STDIO=1, so the @FrontMcp decorator connects stdio instead of HTTP.
  describe('decorated class with FRONTMCP_STDIO=1 (the --stdio runner flow)', () => {
    it('serves MCP over stdio and binds NO TCP port', async () => {
      await connect('src/main.ts', { FRONTMCP_STDIO: '1' });

      const tools = await client!.listTools();
      expect(tools.tools.map((t) => t.name)).toContain('create-note');

      // Decorator served stdio (not HTTP) — the configured port must be free.
      expect(await isTcpPortListening(TEST_PORT)).toBe(false);
    }, 30000);
  });

  // ── #451 — runStdio(serverConfig) with a plain config object ──
  describe('runStdio(serverConfig) — plain config object', () => {
    it('serves over stdio and binds NO TCP port', async () => {
      await connect('src/stdio-entrypoint.ts');

      const tools = await client!.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);

      expect(await isTcpPortListening(TEST_PORT)).toBe(false);
    }, 30000);
  });

  // ── #450 — runStdio(DecoratedClass) resolves @FrontMcp metadata ──
  describe('runStdio(DecoratedClass) — accepts a @FrontMcp class', () => {
    it('resolves config from the class, serves over stdio, binds NO TCP port', async () => {
      // Would reject during connect() if runStdio still threw the Zod
      // "apps expected array" error on a class input.
      await connect('src/stdio-class-entrypoint.ts');

      const tools = await client!.listTools();
      expect(tools.tools.map((t) => t.name)).toContain('create-note');

      expect(await isTcpPortListening(TEST_PORT)).toBe(false);
    }, 30000);
  });
});
