import { join } from 'node:path';

import type { CallToolResult } from '@frontmcp/protocol';
import { McpTestClient, TestServer, TestTokenFactory } from '@frontmcp/testing';

import type { MockBillingApi, MockInvoice } from '../../../e2e/demo-e2e-skilled-openapi/e2e/helpers/mock-billing-api';
import { ProductionEnvironment } from '../../../e2e/demo-e2e-skilled-openapi/e2e/helpers/production-environment';
import { SKILLED_SERVER } from '../../../e2e/demo-e2e-skilled-openapi/e2e/helpers/skilled-client';
import type { ModelTool } from './model';
import type { CallTool } from './run-task';

export const WORKSPACE_ROOT = join(__dirname, '../../../..');

/** One MCP session, as a host opens one for each conversation. */
export interface McpSession {
  readonly serverName: string;
  readonly instructions: string;
  readonly tools: ModelTool[];
  readonly callTool: CallTool;
  close(): Promise<void>;
}

export interface EvalEnvironment {
  readonly billingApi: MockBillingApi;
  /** A new session as an administrator, who may make refunds over 100, so a refund the API refuses reaches the API. */
  connect(): Promise<McpSession>;
  stop(): Promise<void>;
}

function resultText(result: CallToolResult): string {
  const texts = result.content.flatMap((item) => (item.type === 'text' ? [item.text] : []));
  if (texts.length > 0) return texts.join('\n');
  return result.structuredContent ? JSON.stringify(result.structuredContent) : '';
}

async function openSession(client: McpTestClient): Promise<McpSession> {
  const tools = await client.tools.list();
  return {
    serverName: client.serverInfo.name,
    instructions: client.instructions,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
    })),
    async callTool(name, input) {
      const result = await client.tools.call(name, input);
      if (result.error) return { text: result.error.message, isError: true };
      return { text: resultText(result.raw), isError: result.isError, structuredContent: result.raw.structuredContent };
    },
    close: () => client.disconnect(),
  };
}

/**
 * Starts the Skilled OpenAPI e2e server in its production settings (a signed bundle, `unprotectedOps: 'deny'`, an
 * HTTPS billing API) with `seedInvoices` in the billing API and its reports answering at once.
 */
export async function startEvalEnvironment(seedInvoices: readonly MockInvoice[]): Promise<EvalEnvironment> {
  const production = new ProductionEnvironment({ seedInvoices, revenueReportDelayMs: 0, exportDelayMs: 0 });
  await production.start();
  let server: TestServer;
  try {
    server = await TestServer.start({
      project: 'evals-skilled-openapi',
      cwd: WORKSPACE_ROOT,
      command: `npx tsx ${SKILLED_SERVER.server}`,
      // The server never needs the model's API key.
      env: { ...production.env, ANTHROPIC_API_KEY: '' },
    });
  } catch (error) {
    await production.stop();
    throw error;
  }

  const { baseUrl } = server.info;
  const tokens = new TestTokenFactory({ hmacSecret: production.env['JWT_SECRET'], issuer: baseUrl, audience: baseUrl });
  return {
    billingApi: production.billingApi,
    async connect() {
      const token = await tokens.createTestToken({ sub: 'eval-admin', claims: { realm_access: { roles: ['admin'] } } });
      const client = await McpTestClient.create({
        baseUrl,
        publicMode: SKILLED_SERVER.publicMode,
        auth: { token },
      }).buildAndConnect();
      return openSession(client);
    },
    async stop() {
      await server.stop();
      await production.stop();
    },
  };
}
