/**
 * A tool CodeCall hides from `tools/list` is reachable only through CodeCall (#678).
 *
 * `codecall_only` hid every tool from `tools/list` and promised they are reached through CodeCall,
 * but a client that knew a tool's name could still `tools/call` it directly, past every CodeCall
 * policy: `includeTools`, the blocked namespaces, `enabledInCodeCall: false` and `directCalls`. A
 * direct call of a hidden tool is now answered like a call of an unknown tool. CodeCall's own
 * calls (`codecall:execute`, `codecall:invoke`) and a tool calling another (`this.callTool()`)
 * still reach it.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { Client, type CallToolResult } from '@frontmcp/protocol';
import { App, createInMemoryServer, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput } from '../codecall.types';

const executedTools: string[] = [];

function ran(name: string): { ran: string } {
  executedTools.push(name);
  return { ran: name };
}

@Tool({ name: 'users:list', description: 'Lists the users of the account', inputSchema: {} })
class ListUsersTool extends ToolContext {
  async execute() {
    return ran('users:list');
  }
}

@Tool({
  name: 'users:get',
  description: 'Gets one user of the account',
  inputSchema: {},
  codecall: { visibleInListTools: true },
})
class GetUserTool extends ToolContext {
  async execute() {
    return ran('users:get');
  }
}

@Tool({
  name: 'users:delete',
  description: 'Deletes a user of the account',
  inputSchema: { id: z.string() },
})
class DeleteUserTool extends ToolContext {
  async execute() {
    return ran('users:delete');
  }
}

@Tool({ name: 'admin:purge', description: 'Purges every user of the account', inputSchema: {} })
class PurgeUsersTool extends ToolContext {
  async execute() {
    return ran('admin:purge');
  }
}

@Tool({
  name: 'reports:users',
  description: 'Builds a report from the user list',
  inputSchema: {},
  codecall: { visibleInListTools: true },
})
class UsersReportTool extends ToolContext {
  async execute() {
    const users = await this.callTool('users:list', {});
    executedTools.push('reports:users');
    return { report: !users.isError };
  }
}

@Tool({ name: 'invoices:list', description: 'Lists the invoices of the account', inputSchema: {} })
class ListInvoicesTool extends ToolContext {
  async execute() {
    return ran('invoices:list');
  }
}

@Tool({
  name: 'invoices:void',
  description: 'Voids an invoice',
  inputSchema: {},
  codecall: { visibleInListTools: false },
})
class VoidInvoiceTool extends ToolContext {
  async execute() {
    return ran('invoices:void');
  }
}

function structured<T>(result: CallToolResult): T {
  if (result.structuredContent) return result.structuredContent as T;
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('the tool returned no text content');
  return JSON.parse(first.text) as T;
}

/** The response with the tool's name blanked, to compare a refusal with an unknown tool's answer. */
function anonymized(result: CallToolResult, name: string): unknown {
  return { isError: result.isError, content: JSON.stringify(result.content).split(name).join('<tool>') };
}

async function connectTo(apps: Parameters<typeof FrontMcpInstance.createForGraph>[0]['apps']) {
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'codecall-direct-call', version: '1.0.0' },
    apps,
    logging: { level: LogLevel.Off },
  });
  const scope = instance.getScopes()[0];
  if (!scope) throw new Error('the server config produced no scope');
  const server = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
  const client = new Client({ name: 'codecall-direct-call-spec', version: '1.0.0' });
  await client.connect(server.clientTransport);
  return {
    call: async (name: string, args: Record<string, unknown> = {}) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
    listed: async () => (await client.listTools()).tools.map((tool) => tool.name).sort(),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

const CODECALL_ONLY: CodeCallPluginOptionsInput = {
  mode: 'codecall_only',
  includeTools: (tool) => !tool.name.startsWith('admin:'),
  directCalls: { enabled: true },
};

describe('CodeCall — direct tools/call of a tool it hides (#678)', () => {
  describe('in codecall_only mode, with another app that has no CodeCall plugin', () => {
    let server: Awaited<ReturnType<typeof connectTo>>;

    beforeAll(async () => {
      @App({
        id: 'crm',
        name: 'CRM',
        tools: [ListUsersTool, GetUserTool, DeleteUserTool, PurgeUsersTool, UsersReportTool],
        plugins: [CodeCallPlugin.init(CODECALL_ONLY)],
      })
      class CrmApp {}

      @App({ id: 'billing', name: 'Billing', tools: [ListInvoicesTool] })
      class BillingApp {}

      server = await connectTo([CrmApp, BillingApp]);
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(() => {
      executedTools.length = 0;
    });

    it('lists only the meta-tools and the tools marked visibleInListTools', async () => {
      const listed = await server.listed();

      expect(listed).toEqual(expect.arrayContaining(['users:get', 'reports:users', 'codecall:execute']));
      expect(listed).not.toEqual(expect.arrayContaining(['users:list']));
      expect(listed.filter((name) => ['users:list', 'admin:purge', 'invoices:list'].includes(name))).toEqual([]);
    });

    it.each(['users:list', 'admin:purge', 'invoices:list'])(
      'answers a direct call of hidden %s like a call of an unknown tool, and never runs it',
      async (name) => {
        const refused = await server.call(name);
        const unknown = await server.call('nothing:here');

        expect(anonymized(refused, name)).toEqual(anonymized(unknown, 'nothing:here'));
        expect(refused.isError).toBe(true);
        expect(executedTools).toEqual([]);
      },
    );

    it('refuses it before validating the input, which would reveal its schema', async () => {
      const refused = await server.call('users:delete');
      const unknown = await server.call('nothing:here');

      expect(anonymized(refused, 'users:delete')).toEqual(anonymized(unknown, 'nothing:here'));
      expect(executedTools).toEqual([]);
    });

    it('also refuses the hidden tool by its app-qualified name', async () => {
      const refused = await server.call('crm:users:list');

      expect(refused.isError).toBe(true);
      expect(executedTools).toEqual([]);
    });

    it('runs a tool marked visibleInListTools when called directly', async () => {
      const result = await server.call('users:get');

      expect(result.isError).toBeFalsy();
      expect(executedTools).toEqual(['users:get']);
    });

    it('runs the hidden tool through codecall:invoke and codecall:execute', async () => {
      const invoked = await server.call('codecall:invoke', { tool: 'users:list', input: {} });
      const executed = structured<{ status: string }>(
        await server.call('codecall:execute', { script: `return await callTool('users:list', {});` }),
      );

      expect({ invoked: invoked.isError ?? false, executed: executed.status }).toEqual({
        invoked: false,
        executed: 'ok',
      });
      expect(executedTools).toEqual(['users:list', 'users:list']);
    });

    it('runs the hidden tool for a tool that calls it with this.callTool()', async () => {
      const result = await server.call('reports:users');

      expect(structured<{ report: boolean }>(result)).toEqual({ report: true });
      expect(executedTools).toEqual(['users:list', 'reports:users']);
    });

    it('keeps refusing through CodeCall what its policy withholds', async () => {
      const invoked = await server.call('codecall:invoke', { tool: 'admin:purge', input: {} });

      expect(invoked.isError).toBe(true);
      expect(executedTools).toEqual([]);
    });
  });

  describe('with a CodeCall plugin on each of two apps', () => {
    let server: Awaited<ReturnType<typeof connectTo>>;

    beforeAll(async () => {
      @App({
        id: 'crm',
        name: 'CRM',
        tools: [ListUsersTool, GetUserTool],
        plugins: [CodeCallPlugin.init({ mode: 'codecall_only' })],
      })
      class CrmApp {}

      @App({
        id: 'billing',
        name: 'Billing',
        tools: [ListInvoicesTool, VoidInvoiceTool],
        plugins: [CodeCallPlugin.init({ mode: 'metadata_driven' })],
      })
      class BillingApp {}

      server = await connectTo([CrmApp, BillingApp]);
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(() => {
      executedTools.length = 0;
    });

    it('lists exactly the tools a client can call directly, each judged by its own app', async () => {
      const tools = ['users:list', 'users:get', 'invoices:list', 'invoices:void'];
      const listed = await server.listed();
      const callable: string[] = [];
      for (const name of tools) {
        if (!(await server.call(name)).isError) callable.push(name);
      }

      expect({ listed: tools.filter((name) => listed.includes(name)), callable }).toEqual({
        listed: ['users:get', 'invoices:list'],
        callable: ['users:get', 'invoices:list'],
      });
    });
  });

  describe('in metadata_driven mode', () => {
    let server: Awaited<ReturnType<typeof connectTo>>;

    beforeAll(async () => {
      @App({
        id: 'billing',
        name: 'Billing',
        tools: [ListInvoicesTool, VoidInvoiceTool],
        plugins: [CodeCallPlugin.init({ mode: 'metadata_driven' })],
      })
      class BillingApp {}

      server = await connectTo([BillingApp]);
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(() => {
      executedTools.length = 0;
    });

    it('runs a listed tool when called directly', async () => {
      const result = await server.call('invoices:list');

      expect(result.isError).toBeFalsy();
      expect(executedTools).toEqual(['invoices:list']);
    });

    it('refuses a direct call of a tool marked visibleInListTools: false', async () => {
      const refused = await server.call('invoices:void');

      expect(refused.isError).toBe(true);
      expect(executedTools).toEqual([]);
    });
  });
});
