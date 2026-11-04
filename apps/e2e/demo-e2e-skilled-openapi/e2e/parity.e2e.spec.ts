// Scenarios J1 G3 E6: streamable HTTP and stdio, on the same config and signed bundle, give the same answers.
import { join } from 'node:path';

import { expect, McpClient, McpStdioClientTransport, test, type CallToolResult } from '@frontmcp/testing';

import { ProductionEnvironment } from './helpers/production-environment';
import { callToolOver, sharedOperationAccess, SKILLED_SERVER, type CallTool } from './helpers/skilled-client';

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

function normaliseTools(tools: ReadonlyArray<NormalizedTool>): readonly NormalizedTool[] {
  return tools
    .map(
      (tool): NormalizedTool => ({
        name: tool.name,
        ...(tool.description !== undefined && { description: tool.description }),
        ...(tool.inputSchema !== undefined && { inputSchema: tool.inputSchema }),
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normaliseResourceTemplates(
  templates: ReadonlyArray<NormalizedResourceTemplate>,
): readonly NormalizedResourceTemplate[] {
  return templates
    .map(
      (template): NormalizedResourceTemplate => ({
        uriTemplate: template.uriTemplate,
        ...(template.name !== undefined && { name: template.name }),
        ...(template.description !== undefined && { description: template.description }),
        ...(template.mimeType !== undefined && { mimeType: template.mimeType }),
      }),
    )
    .sort((a, b) => a.uriTemplate.localeCompare(b.uriTemplate));
}

/** A tool result as both transports should give it: a workflow's run time is the one field that may differ. */
function comparableResult(result: CallToolResult): unknown {
  const structured = result.structuredContent;
  const stats = structured?.['stats'] as Record<string, unknown> | undefined;
  if (!structured || !stats) return { isError: result.isError === true, content: result.content };
  const { durationMs: _durationMs, ...statsWithoutDuration } = stats;
  return { isError: result.isError === true, structured: { ...structured, stats: statsWithoutDuration } };
}

/** Whether a call did what it asked: no tool error, and no `success: false` from a workflow. */
function succeeded(result: CallToolResult): boolean {
  return result.isError !== true && result.structuredContent?.['success'] !== false;
}

interface ParityCall {
  name: string;
  args: Record<string, unknown>;
  succeeds: boolean;
}

const CREATE_THEN_GET_INVOICE =
  "const created = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 1234 }); return await callTool('getInvoice', { id: created.id });";

const TOOL_CALLS: readonly ParityCall[] = [
  { name: 'search_skill', args: { query: 'refund invoice' }, succeeds: true },
  { name: 'search_skill', args: { query: 'billing', tags: ['reports'] }, succeeds: true },
  { name: 'load_skill', args: { skillId: 'Invoices' }, succeeds: true },
  { name: 'load_skill', args: { skillIds: ['invoices', 'reports'] }, succeeds: true },
  { name: 'load_skill', args: { skillId: 'billing-admin' }, succeeds: false },
  { name: 'run_workflow', args: { script: CREATE_THEN_GET_INVOICE }, succeeds: true },
  {
    name: 'run_workflow',
    args: { script: "return await callTool('getInvoice', { id: 'inv_missing' });" },
    succeeds: false,
  },
  { name: 'run_workflow', args: { script: "return await callTool('adminPing', {});" }, succeeds: false },
  { name: 'execute_action', args: { actionId: 'getAccountPlan' }, succeeds: true },
  {
    name: 'execute_action',
    args: { actionId: 'createInvoice', input: { customerId: 'cus_e2e', amount: 5 } },
    succeeds: true,
  },
  { name: 'execute_action', args: { actionId: 'getInvoice', input: { id: 'inv_missing' } }, succeeds: false },
  { name: 'execute_action', args: { actionId: 'getInvoice', input: {} }, succeeds: false },
  { name: 'execute_action', args: { actionId: 'adminPing', input: {} }, succeeds: false },
  { name: 'execute_action', args: { actionId: 'doesNotExist', input: {} }, succeeds: false },
];

const environment = new ProductionEnvironment();

test.describe('Skilled-OpenAPI cross-runtime parity', () => {
  test.use({ ...SKILLED_SERVER, env: environment.env });
  test.beforeAll(() => environment.start());
  test.afterAll(() => environment.stop());

  const stdioEntrypoint = join(__dirname, '../src/stdio-entrypoint.ts');
  const stdioCwd = join(__dirname, '..');

  let stdioClient: McpClient | null = null;
  let stdioTransport: McpStdioClientTransport | null = null;

  test.afterEach(async () => {
    await stdioClient?.close().catch(() => undefined);
    await stdioTransport?.close().catch(() => undefined);
    stdioClient = null;
    stdioTransport = null;
  });

  async function connectStdio(): Promise<McpClient> {
    stdioTransport = new McpStdioClientTransport({
      command: 'npx',
      args: ['tsx', stdioEntrypoint],
      env: { ...(process.env as Record<string, string>), ...environment.env },
      cwd: stdioCwd,
    });
    stdioClient = new McpClient({ name: 'parity-stdio-client', version: '1.0.0' }, { capabilities: {} });
    await stdioClient.connect(stdioTransport);
    return stdioClient;
  }

  test('tools/list matches between streamable-HTTP and stdio transports', async ({ mcp }) => {
    const stdio = await connectStdio();

    const httpTools = normaliseTools(await mcp.tools.list());
    const stdioTools = normaliseTools((await stdio.listTools()).tools);

    expect(httpTools.map((tool) => tool.name)).toEqual([
      'execute_action',
      'load_skill',
      'run_workflow',
      'search_skill',
    ]);
    expect(stdioTools).toEqual(httpTools);
  });

  test('resources/templates/list matches between streamable-HTTP and stdio transports', async ({ mcp }) => {
    const stdio = await connectStdio();

    const httpTemplates = normaliseResourceTemplates(await mcp.resources.listTemplates());
    const stdioTemplates = normaliseResourceTemplates((await stdio.listResourceTemplates()).resourceTemplates);

    expect(stdioTemplates).toEqual(httpTemplates);
  });

  test('the initialize instructions match', async ({ mcp }) => {
    const stdio = await connectStdio();

    expect(mcp.instructions).toContain('This server has 2 skills');
    expect(stdio.getInstructions()).toBe(mcp.instructions);
  });

  test('search_skill, load_skill, execute_action and run_workflow give the same results and errors', async ({
    mcp,
  }) => {
    const stdio = await connectStdio();

    for (const { name, args, succeeds } of TOOL_CALLS) {
      environment.billingApi.reset();
      const overHttp = (await mcp.tools.call(name, args)).raw;
      environment.billingApi.reset();
      const overStdio = (await stdio.callTool({ name, arguments: args })) as CallToolResult;

      expect({ name, args, succeeded: succeeded(overHttp) }).toEqual({ name, args, succeeded: succeeds });
      expect({ name, args, result: comparableResult(overStdio) }).toEqual({
        name,
        args,
        result: comparableResult(overHttp),
      });
    }
  });

  test('an operation a public and an admin-only skill both list runs over stdio, as load_skill shows (G3)', async ({
    mcp,
  }) => {
    const stdio = await connectStdio();
    const callToolOverStdio: CallTool = async (name, args) =>
      (await stdio.callTool({ name, arguments: args })) as CallToolResult;

    const overStdio = await sharedOperationAccess(callToolOverStdio);

    expect(overStdio).toEqual({ shown: ['getInvoice'], runnable: ['getInvoice'], executable: ['getInvoice'] });
    expect(overStdio).toEqual(await sharedOperationAccess(callToolOver(mcp)));
  });
});
