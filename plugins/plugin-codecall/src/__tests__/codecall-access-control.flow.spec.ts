/**
 * CodeCall's tool-access policy, driven through a real server (GHSA-6w3j-82v5-6qrr).
 *
 * The earlier access-control specs use stub entries whose `name` equals their `fullName`, so they
 * cannot see a policy that judges `fullName` while search judges `name`. Here every tool lives in
 * app `crm`, so the SDK registers `admin:deleteUser` with the qualified name
 * `crm:admin:deleteUser`, and every request runs the real `tools:call-tool` flow.
 */
import 'reflect-metadata';

import { Client, type CallToolResult } from '@frontmcp/protocol';
import { App, createInMemoryServer, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput, CodeCallToolMetadata } from '../codecall.types';

const executedTools: string[] = [];

function recordingTool(name: string, codecall?: CodeCallToolMetadata) {
  @Tool({ name, description: `Runs ${name} for the access-control spec`, inputSchema: {}, codecall })
  class RecordingTool extends ToolContext {
    async execute() {
      executedTools.push(name);
      return { ran: name };
    }
  }
  return RecordingTool;
}

function buildCrmTools() {
  return [
    recordingTool('users:list'),
    recordingTool('users:get'),
    recordingTool('get_report'),
    recordingTool('billing.getInvoice'),
    recordingTool('billing.refundAll', { enabledInCodeCall: false }),
    recordingTool('admin:deleteUser'),
    recordingTool('users:export', { enabledInCodeCall: false }),
    recordingTool('system:wipeConfig'),
    recordingTool('internal:dumpState'),
    recordingTool('__debugDump'),
  ];
}

const DENIED_TOOLS = [
  'admin:deleteUser',
  'crm:admin:deleteUser',
  'users:export',
  'system:wipeConfig',
  'internal:dumpState',
  '__debugDump',
];

interface ExecuteOutcome {
  status: string;
  result?: unknown;
}

interface DescribeOutcome {
  tools: Array<{ name: string }>;
  notFound?: string[];
}

interface SearchOutcome {
  tools: Array<{ name: string }>;
  totalAvailableTools: number;
}

interface CodeCallServer {
  client: Client;
  close(): Promise<void>;
}

async function startCodeCallServer(codecallOptions: CodeCallPluginOptionsInput): Promise<CodeCallServer> {
  @App({
    id: 'crm',
    name: 'CRM',
    tools: buildCrmTools(),
    plugins: [CodeCallPlugin.init(codecallOptions)],
  })
  class CrmApp {}

  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'codecall-access-control', version: '1.0.0' },
    apps: [CrmApp],
    logging: { level: LogLevel.Off },
  });
  const scope = instance.getScopes()[0];
  if (!scope) throw new Error('the server config produced no scope');

  const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
  const client = new Client({ name: 'codecall-access-control-spec', version: '1.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await client.close();
      await close();
    },
  };
}

function readStructured<T>(result: CallToolResult): T {
  if (result.structuredContent) return result.structuredContent as T;
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('the tool returned no text content');
  return JSON.parse(first.text) as T;
}

async function callCodeCall(server: CodeCallServer, name: string, args: Record<string, unknown>) {
  return (await server.client.callTool({ name, arguments: args })) as CallToolResult;
}

async function runScript(server: CodeCallServer, script: string): Promise<ExecuteOutcome> {
  return readStructured<ExecuteOutcome>(await callCodeCall(server, 'codecall:execute', { script }));
}

async function invoke(server: CodeCallServer, tool: string): Promise<CallToolResult> {
  return callCodeCall(server, 'codecall:invoke', { tool, input: {} });
}

const EXCLUDE_ADMIN_TOOLS: CodeCallPluginOptionsInput['includeTools'] = (tool) => !tool.name.startsWith('admin:');

function useCodeCallServer(codecallOptions: CodeCallPluginOptionsInput): () => CodeCallServer {
  let server: CodeCallServer | undefined;

  beforeAll(async () => {
    server = await startCodeCallServer(codecallOptions);
  });

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(() => {
    executedTools.length = 0;
  });

  return () => {
    if (!server) throw new Error('the CodeCall server has not started');
    return server;
  };
}

describe('CodeCall tool access through the real tools:call-tool flow (GHSA-6w3j-82v5-6qrr)', () => {
  const server = useCodeCallServer({ mode: 'codecall_only', includeTools: EXCLUDE_ADMIN_TOOLS });

  describe('codecall:execute', () => {
    it.each(DENIED_TOOLS)('refuses callTool("%s") and never runs the tool', async (name) => {
      const outcome = await runScript(server(), `return await callTool('${name}', {});`);

      expect(outcome.status).not.toBe('ok');
      expect(executedTools).toEqual([]);
    });

    it('still runs an allowed tool', async () => {
      const outcome = await runScript(server(), `return await callTool('users:list', {});`);

      expect(outcome.status).toBe('ok');
      expect(executedTools).toEqual(['users:list']);
    });

    it('still blocks a script calling a CodeCall meta-tool', async () => {
      const outcome = await runScript(server(), `return await callTool('codecall:invoke', { tool: 'users:list' });`);

      expect(outcome.status).not.toBe('ok');
      expect(executedTools).toEqual([]);
    });

    it('describes no denied tool through getTool', async () => {
      const outcome = await runScript(
        server(),
        `const names = ${JSON.stringify(DENIED_TOOLS)};
         return names.map((name) => getTool(name) === undefined);`,
      );

      expect(outcome).toEqual({ status: 'ok', result: DENIED_TOOLS.map(() => true) });
    });

    it('resolves getTool through the same hyphen/underscore alias as callTool', async () => {
      const outcome = await runScript(server(), `return getTool('get-report')?.name;`);

      expect(outcome).toEqual({ status: 'ok', result: 'get_report' });
    });

    it('binds namespace methods only for allowed tools', async () => {
      const outcome = await runScript(
        server(),
        `return { getInvoice: typeof billing.getInvoice, refundAll: typeof billing.refundAll };`,
      );

      expect(outcome).toEqual({ status: 'ok', result: { getInvoice: 'function', refundAll: 'undefined' } });
    });
  });

  describe('codecall:invoke', () => {
    it.each(DENIED_TOOLS)('refuses "%s" and never runs the tool', async (name) => {
      const result = await invoke(server(), name);

      expect(result.isError).toBe(true);
      expect(executedTools).toEqual([]);
    });

    it('still invokes an allowed tool', async () => {
      const result = await invoke(server(), 'users:get');

      expect(result.isError).toBeFalsy();
      expect(executedTools).toEqual(['users:get']);
    });

    it('still refuses a CodeCall meta-tool', async () => {
      const result = await invoke(server(), 'codecall:execute');

      expect(result.isError).toBe(true);
    });
  });

  describe('codecall:describe', () => {
    it('reports every denied tool as not found, exactly like an unknown name', async () => {
      const outcome = readStructured<DescribeOutcome>(
        await callCodeCall(server(), 'codecall:describe', { toolNames: [...DENIED_TOOLS, 'no-such-tool'] }),
      );

      expect(outcome.tools).toEqual([]);
      expect(outcome.notFound).toEqual([...DENIED_TOOLS, 'no-such-tool']);
    });

    it('still describes an allowed tool', async () => {
      const outcome = readStructured<DescribeOutcome>(
        await callCodeCall(server(), 'codecall:describe', { toolNames: ['users:list', 'get-report'] }),
      );

      expect(outcome.tools.map((tool) => tool.name)).toEqual(['users:list', 'get_report']);
    });
  });

  describe('codecall:search', () => {
    it('indexes exactly the tools execution allows', async () => {
      const outcome = readStructured<SearchOutcome>(
        await callCodeCall(server(), 'codecall:search', {
          queries: ['delete user', 'export users', 'wipe config', 'dump state', 'debug dump', 'refund all'],
          topK: 50,
          minRelevanceScore: 0,
        }),
      );

      const foundNames = outcome.tools.map((tool) => tool.name);
      for (const deniedName of [...DENIED_TOOLS, 'billing.refundAll']) {
        expect(foundNames).not.toContain(deniedName);
      }
      expect(outcome.totalAvailableTools).toBe(4);
    });
  });
});

describe('CodeCall directCalls.allowedTools (GHSA-6w3j-82v5-6qrr)', () => {
  const server = useCodeCallServer({
    mode: 'codecall_only',
    includeTools: EXCLUDE_ADMIN_TOOLS,
    directCalls: { enabled: true, allowedTools: ['users:list', 'admin:deleteUser'] },
  });

  it('invokes a tool listed by its bare name', async () => {
    const result = await invoke(server(), 'users:list');

    expect(result.isError).toBeFalsy();
    expect(executedTools).toEqual(['users:list']);
  });

  it('invokes a tool listed by its bare name when called by its qualified name', async () => {
    const result = await invoke(server(), 'crm:users:list');

    expect(result.isError).toBeFalsy();
    expect(executedTools).toEqual(['users:list']);
  });

  it('refuses an allowed tool that is not listed', async () => {
    const result = await invoke(server(), 'users:get');

    expect(result.isError).toBe(true);
    expect(executedTools).toEqual([]);
  });

  it('never widens the base policy: a listed tool that includeTools excludes stays refused', async () => {
    const result = await invoke(server(), 'admin:deleteUser');

    expect(result.isError).toBe(true);
    expect(executedTools).toEqual([]);
  });
});

describe('CodeCall with directCalls disabled (GHSA-6w3j-82v5-6qrr)', () => {
  const server = useCodeCallServer({ mode: 'codecall_only', directCalls: { enabled: false } });

  it('refuses every codecall:invoke request', async () => {
    const result = await invoke(server(), 'users:list');

    expect(result.isError).toBe(true);
    expect(executedTools).toEqual([]);
  });

  it('keeps codecall:execute available for allowed tools', async () => {
    const outcome = await runScript(server(), `return await callTool('users:list', {});`);

    expect(outcome.status).toBe('ok');
    expect(executedTools).toEqual(['users:list']);
  });
});
