import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type JsonRpcError,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Prompt, PromptContext, ResourceContext, ResourceTemplate, Tool, ToolContext } from '../../common';
import { InvalidInputError, PublicMcpError, ResourceNotFoundError } from '../mcp.error';

const INTERNAL_DETAIL = 'connect ECONNREFUSED 10.0.3.7:5432 (user=orders_rw)';
const FAKE_SESSION_SECRET = 'entry-errors-spec-fake-session-secret-0123456789';

@ResourceTemplate({ name: 'order', uriTemplate: 'orders://{id}', mimeType: 'text/plain' })
class OrderResource extends ResourceContext<{ id: string }> {
  async execute(uri: string, params: { id: string }) {
    if (params.id === 'db-down') throw new Error(INTERNAL_DETAIL);
    if (params.id === 'missing') throw new ResourceNotFoundError(uri);
    if (params.id === 'archived') this.fail(new PublicMcpError('Order is archived', 'ORDER_ARCHIVED', 400));
    return { contents: [{ uri, text: `order ${params.id}` }] };
  }
}

@Prompt({ name: 'summarize', arguments: [{ name: 'text', required: true }] })
class SummarizePrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    if (args['text'] === 'db-down') throw new Error(INTERNAL_DETAIL);
    if (args['text'] === 'too-long') this.fail(new PublicMcpError('Text is too long', 'TOO_LONG', 400));
    return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: args['text'] ?? '' } }] };
  }
}

@Tool({ name: 'close_ticket', inputSchema: { how: z.string() } })
class CloseTicketTool extends ToolContext {
  async execute(input: { how: string }) {
    if (input.how === 'invalid-input') throw new InvalidInputError('limit must be at most 100');
    if (input.how === 'public') throw new PublicMcpError('Ticket T-1 is already closed', 'TICKET_CLOSED', 409);
    return { closed: true };
  }
}

@App({
  id: 'shop',
  name: 'shop',
  tools: [CloseTicketTool],
  resources: [OrderResource],
  prompts: [SummarizePrompt],
})
class ShopApp {}

describe('entry errors in production (2026-07-28)', () => {
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalSessionSecret = process.env['MCP_SESSION_SECRET'];
  let server: TestFetchServer;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['MCP_SESSION_SECRET'] = FAKE_SESSION_SECRET;
    server = await createTestFetchServer({ info: { name: 'entry-errors', version: '1.0.0' }, apps: [ShopApp] });
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
    if (originalSessionSecret === undefined) delete process.env['MCP_SESSION_SECRET'];
    else process.env['MCP_SESSION_SECRET'] = originalSessionSecret;
  });

  async function readResourceError(uri: string): Promise<JsonRpcError | undefined> {
    const { message } = await rpc20260728(server.handler, 'resources/read', { uri });
    return message.error;
  }

  async function getPromptError(name: string, args: Record<string, string>): Promise<JsonRpcError | undefined> {
    const { message } = await rpc20260728(server.handler, 'prompts/get', { name, arguments: args });
    return message.error;
  }

  async function callTool(how: string) {
    const { message } = await rpc20260728(server.handler, 'tools/call', { name: 'close_ticket', arguments: { how } });
    const result = message.result as { content: Array<{ text: string }>; _meta?: { code?: string } };
    return { code: result._meta?.code, text: result.content[0]?.text };
  }

  describe('resources', () => {
    it('hides the message of an Error thrown in execute()', async () => {
      const error = await readResourceError('orders://db-down');

      expect(error?.code).toBe(-32603);
      expect(error?.message).not.toContain('ECONNREFUSED');
    });

    it('answers a ResourceNotFoundError thrown in execute() with the not-found code -32602', async () => {
      const error = await readResourceError('orders://missing');

      expect(error?.code).toBe(-32602);
      expect(error?.message).toContain('orders://missing');
    });

    it('keeps the message of a PublicMcpError passed to this.fail()', async () => {
      const error = await readResourceError('orders://archived');

      expect(error?.message).toContain('Order is archived');
    });

    it('answers a URI that matches no resource with a message that does not name another code', async () => {
      const error = await readResourceError('nothing://here');

      expect(error?.code).toBe(-32602);
      expect(error?.message).not.toContain('MCP error -32002');
    });
  });

  describe('prompts', () => {
    it('hides the message of an Error thrown in execute()', async () => {
      const error = await getPromptError('summarize', { text: 'db-down' });

      expect(error?.code).toBe(-32603);
      expect(error?.message).not.toContain('ECONNREFUSED');
    });

    it('keeps the message of a PublicMcpError passed to this.fail()', async () => {
      const error = await getPromptError('summarize', { text: 'too-long' });

      expect(error?.message).toContain('Text is too long');
    });

    it('answers a missing required argument with invalid params -32602', async () => {
      const error = await getPromptError('summarize', {});

      expect(error?.code).toBe(-32602);
    });

    it('answers an unknown prompt name with invalid params -32602', async () => {
      const error = await getPromptError('no-such-prompt', {});

      expect(error?.code).toBe(-32602);
    });
  });

  describe('tools', () => {
    it('keeps the INVALID_INPUT code and message of a thrown InvalidInputError', async () => {
      const result = await callTool('invalid-input');

      expect(result).toEqual({ code: 'INVALID_INPUT', text: 'limit must be at most 100' });
    });

    it('keeps the code and message of a thrown PublicMcpError', async () => {
      const result = await callTool('public');

      expect(result).toEqual({ code: 'TICKET_CLOSED', text: 'Ticket T-1 is already closed' });
    });
  });
});
