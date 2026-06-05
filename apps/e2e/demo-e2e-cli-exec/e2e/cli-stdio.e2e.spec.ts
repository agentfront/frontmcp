/**
 * E2E: the built bundle serves MCP over stdio with `--stdio`, binding NO TCP
 * port.
 *
 * Drives the compiled bundle (not tsx), so this exercises the real artifact
 * users ship:
 *  - #448 — `--stdio` is honored by the built bundle and serves stdin/stdout
 *           JSON-RPC instead of starting the HTTP server.
 *  - #451 — `runStdio()` forces the no-op server, so the fixture's configured
 *           http port (3151) stays closed while stdio is connected.
 */

import { isTcpPortListening, McpClient, McpStdioClientTransport } from '@frontmcp/testing';

import { ensureBuild, getCliBundlePath } from './helpers/exec-cli';

// The fixture configures `http: { port: 3151 }`. In stdio mode nothing should
// listen there; if the HTTP server were (wrongly) started it would bind it.
const HTTP_PORT = 3151;

describe('CLI built bundle — stdio mode (--stdio)', () => {
  let client: McpClient | null = null;
  let transport: McpStdioClientTransport | null = null;

  beforeAll(async () => {
    await ensureBuild();
  }, 180000);

  afterEach(async () => {
    if (client) {
      try {
        await client.close();
      } catch {
        /* already exited */
      }
      client = null;
    }
    if (transport) {
      try {
        await transport.close();
      } catch {
        /* already exited */
      }
      transport = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  async function connectStdio(): Promise<void> {
    transport = new McpStdioClientTransport({
      command: 'node',
      args: [getCliBundlePath(), '--stdio'],
      env: { ...process.env, PORT: String(HTTP_PORT) } as Record<string, string>,
    });
    client = new McpClient({ name: 'cli-stdio-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
  }

  it('lists tools over stdio and binds NO HTTP port', async () => {
    await connectStdio();

    const tools = await client!.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain('add');
    expect(names).toContain('greet');

    // stdio mode must not open the configured HTTP listener.
    expect(await isTcpPortListening(HTTP_PORT)).toBe(false);
  }, 60000);

  it('calls a tool over stdio and returns a structured result', async () => {
    await connectStdio();

    const result = await client!.callTool({ name: 'add', arguments: { a: 2, b: 3 } });
    expect(result.isError).not.toBe(true);

    const textContent = result.content.find((c: { type: string }) => c.type === 'text');
    expect(textContent).toBeDefined();
    expect((textContent as { text: string }).text).toContain('5');
  }, 60000);
});
