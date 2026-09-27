/**
 * `ApprovalPlugin` installed on one app, and a tool with `approval` in another app that has no
 * approval plugin of its own.
 *
 * In 1.8.2 the gate was a hook of the app the plugin was installed on, and the SDK runs an app's
 * hooks only for that app's tools, so the other app's `approval: true` tools ran for anyone. The
 * gate now also covers the tools of apps that have no approval gate of their own (#600 keeps
 * each app that does have one judged by its own store).
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  App,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  type DirectAuthContext,
  type DirectMcpServer,
} from '@frontmcp/sdk';
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { ApprovalPlugin, ApprovalRequiredError } from '../index';

const executed: string[] = [];

@Tool({ name: 'delete_repo', inputSchema: {}, approval: true })
class DeleteRepoTool extends ToolContext {
  async execute() {
    executed.push('delete_repo');
    return { deleted: true };
  }
}

@Tool({ name: 'refund', inputSchema: {}, approval: true })
class RefundTool extends ToolContext {
  async execute() {
    executed.push('refund');
    return { refunded: true };
  }
}

@Tool({ name: 'invoice', inputSchema: {} })
class InvoiceTool extends ToolContext {
  async execute() {
    executed.push('invoice');
    return { invoiced: true };
  }
}

@Tool({ name: 'grant', inputSchema: { toolId: z.string() } })
class GrantTool extends ToolContext {
  async execute({ toolId }: { toolId: string }) {
    await this.approval.grantSessionApproval(toolId);
    return { granted: toolId };
  }
}

const CALLER: DirectAuthContext = { sessionId: 'session-alice', user: { sub: 'alice' } };

async function outcome(server: DirectMcpServer, name: string): Promise<'ran' | 'refused'> {
  try {
    await server.callTool(name, {}, { authContext: CALLER });
    return 'ran';
  } catch (error) {
    if (error instanceof ApprovalRequiredError) return 'refused';
    throw error;
  }
}

describe('ApprovalPlugin installed on one app of a server with several apps', () => {
  let storage: RootStorage;
  let server: DirectMcpServer;

  beforeEach(async () => {
    executed.length = 0;
    storage = createMemoryStorage();
    await storage.connect();

    @App({
      id: 'repos',
      name: 'Repos',
      plugins: [ApprovalPlugin.init({ storageInstance: storage })],
      tools: [DeleteRepoTool, GrantTool],
    })
    class ReposApp {}

    @App({ id: 'billing', name: 'Billing', tools: [RefundTool, InvoiceTool] })
    class BillingApp {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'approval-cross-app', version: '1.0.0' },
      apps: [ReposApp, BillingApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it("refuses another app's tool that requires approval", async () => {
    expect(await outcome(server, 'refund')).toBe('refused');
    expect(executed).toEqual([]);
  });

  it("runs another app's tool once the plugin's store approves it", async () => {
    await server.callTool('grant', { toolId: 'billing:refund' }, { authContext: CALLER });

    expect(await outcome(server, 'refund')).toBe('ran');
  });

  it("still runs another app's tool that does not require approval", async () => {
    expect(await outcome(server, 'invoice')).toBe('ran');
  });

  it("still gates the plugin's own app", async () => {
    expect(await outcome(server, 'delete_repo')).toBe('refused');
  });
});
