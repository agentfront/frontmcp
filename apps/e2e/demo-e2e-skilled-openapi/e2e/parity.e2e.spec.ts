/**
 * Cross-runtime parity for `@frontmcp/plugin-skilled-openapi`.
 *
 * The plugin doesn't care about the underlying MCP transport — it just
 * augments the server's tools / resources / prompts registries with the
 * skilled-openapi meta-tools and (depending on classification) any
 * GET-with-path-param operations surfaced as resource templates.
 *
 * That decoupling has to be enforced by a test: if a regression couples
 * the plugin to a particular transport, the contract that "the same
 * deploy bundle yields the same MCP discovery output everywhere" silently
 * breaks. This spec runs the SAME `buildServerConfig(...)` through two
 * different transports and asserts the discovery responses match.
 *
 * Transports compared:
 *   - **streamable-HTTP** (existing `main.ts` over the test harness)
 *   - **stdio** (`stdio-entrypoint.ts` spawned as a subprocess; client
 *     connects via `McpStdioClientTransport`)
 *
 * Methods asserted byte-equal (after dropping per-instance ids):
 *   - `tools/list`
 *   - `resources/templates/list`
 *
 * `tools/call` is NOT included here because it talks to the mock REST
 * upstream — the parity claim is about the discovery surface, which is
 * pure data over the static-source bundle.
 */

import { join } from 'node:path';

import { expect, McpClient, McpStdioClientTransport, test } from '@frontmcp/testing';

/** Stable shape we extract from each transport's response for diffing. */
interface NormalizedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

interface NormalizedResourceTemplate {
  readonly uriTemplate: string;
  readonly name?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

/**
 * Normalise an MCP `tools/list` result to a stable shape — sorted by name,
 * description trimmed. The harness and the protocol both occasionally add
 * per-instance metadata (e.g. server-side request ids surfaced via headers
 * in some transports); the normaliser strips anything not part of the MCP
 * data contract.
 */
function normaliseTools(raw: unknown): readonly NormalizedTool[] {
  const tools = extractToolArray(raw);
  return tools
    .map(
      (t): NormalizedTool => ({
        name: t.name,
        ...(t.description !== undefined && { description: t.description }),
        ...(t.inputSchema !== undefined && { inputSchema: t.inputSchema }),
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normaliseResourceTemplates(raw: unknown): readonly NormalizedResourceTemplate[] {
  const templates = extractTemplateArray(raw);
  return templates
    .map(
      (t): NormalizedResourceTemplate => ({
        uriTemplate: t.uriTemplate,
        ...(t.name !== undefined && { name: t.name }),
        ...(t.description !== undefined && { description: t.description }),
        ...(t.mimeType !== undefined && { mimeType: t.mimeType }),
      }),
    )
    .sort((a, b) => a.uriTemplate.localeCompare(b.uriTemplate));
}

function extractToolArray(raw: unknown): Array<{ name: string; description?: string; inputSchema?: unknown }> {
  if (raw && typeof raw === 'object' && 'tools' in raw && Array.isArray((raw as { tools: unknown }).tools)) {
    return (raw as { tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }).tools;
  }
  if (Array.isArray(raw)) return raw as Array<{ name: string }>;
  return [];
}

function extractTemplateArray(
  raw: unknown,
): Array<{ uriTemplate: string; name?: string; description?: string; mimeType?: string }> {
  // The raw client returns `{ resourceTemplates: [...] }` (matches the wire
  // shape); the harness's `mcp.resources.listTemplates()` unwraps to a
  // bare array. Handle both so the parity spec doesn't need transport-
  // specific glue.
  if (
    raw &&
    typeof raw === 'object' &&
    'resourceTemplates' in raw &&
    Array.isArray((raw as { resourceTemplates: unknown }).resourceTemplates)
  ) {
    return (
      raw as {
        resourceTemplates: Array<{ uriTemplate: string; name?: string; description?: string; mimeType?: string }>;
      }
    ).resourceTemplates;
  }
  if (Array.isArray(raw)) {
    return raw as Array<{ uriTemplate: string; name?: string; description?: string; mimeType?: string }>;
  }
  return [];
}

test.describe('Skilled-OpenAPI cross-runtime parity', () => {
  // The HTTP-side server is booted by the test harness — same as the rest
  // of this app's e2e suite.
  test.use({
    server: 'apps/e2e/demo-e2e-skilled-openapi/src/main.ts',
    project: 'demo-e2e-skilled-openapi',
    publicMode: true,
  });

  // The stdio entrypoint lives next to `main.ts`; we spawn it on-demand per
  // test so a flaky run doesn't leak a long-lived subprocess across tests.
  const stdioEntrypoint = join(__dirname, '../src/stdio-entrypoint.ts');
  const stdioCwd = join(__dirname, '..');

  let stdioClient: McpClient | null = null;
  let stdioTransport: McpStdioClientTransport | null = null;

  test.afterEach(async () => {
    if (stdioClient) {
      try {
        await stdioClient.close();
      } catch {
        // Subprocess may have already exited; safe to ignore.
      }
      stdioClient = null;
    }
    if (stdioTransport) {
      try {
        await stdioTransport.close();
      } catch {
        // Transport may have already detached.
      }
      stdioTransport = null;
    }
  });

  async function connectStdio(): Promise<McpClient> {
    stdioTransport = new McpStdioClientTransport({
      command: 'npx',
      args: ['tsx', stdioEntrypoint],
      env: process.env as Record<string, string>,
      cwd: stdioCwd,
    });
    stdioClient = new McpClient({ name: 'parity-stdio-client', version: '1.0.0' }, { capabilities: {} });
    await stdioClient.connect(stdioTransport);
    return stdioClient;
  }

  test('tools/list matches between streamable-HTTP and stdio transports', async ({ mcp }) => {
    const stdio = await connectStdio();

    const httpRaw = await mcp.tools.list();
    const stdioRaw = await stdio.listTools();

    const httpTools = normaliseTools(httpRaw);
    const stdioTools = normaliseTools(stdioRaw);

    // Sanity: both surfaces must expose the three skilled-openapi meta-tools.
    const expectedMeta = ['load_skill', 'run_workflow', 'search_skill'];
    const httpNames = httpTools.map((t) => t.name);
    const stdioNames = stdioTools.map((t) => t.name);
    for (const name of expectedMeta) {
      expect(httpNames).toContain(name);
      expect(stdioNames).toContain(name);
    }

    // The parity assertion itself — the discovery surface is data-only,
    // so deep equality is the right contract.
    expect(stdioTools).toEqual(httpTools);
  });

  test('resources/templates/list matches between streamable-HTTP and stdio transports', async ({ mcp }) => {
    const stdio = await connectStdio();

    // The harness's `mcp` fixture exposes a Resources surface; both names
    // exist in the codebase, so call whichever the client supports.
    const httpRaw = await mcp.resources.listTemplates();
    const stdioRaw = await stdio.listResourceTemplates();

    const httpTemplates = normaliseResourceTemplates(httpRaw);
    const stdioTemplates = normaliseResourceTemplates(stdioRaw);

    // If the bundle declares zero GET-with-path-param operations after
    // classification, both surfaces emit an empty list — that's still a
    // valid parity assertion (an empty array on one side and three
    // templates on the other would catch a regression).
    expect(stdioTemplates).toEqual(httpTemplates);
  });
});
