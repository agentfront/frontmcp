import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';

@Tool({ name: 'echo', inputSchema: { message: z.string() } })
class EchoTool extends ToolContext {
  async execute(input: { message: string }) {
    return { echoed: input.message, clientId: this.context.authInfo.clientId ?? null };
  }
}

@App({ id: 'harness', name: 'harness', tools: [EchoTool] })
class HarnessApp {}

describe('in-process 2026-07-28 client', () => {
  describe('anonymous server', () => {
    let server: TestFetchServer;

    beforeAll(async () => {
      server = await createTestFetchServer({ info: { name: 'harness', version: '1.0.0' }, apps: [HarnessApp] });
    });

    it('lists tools', async () => {
      const { status, message } = await rpc20260728(server.handler, 'tools/list');

      expect(status).toBe(200);
      const tools = message.result?.['tools'] as Array<{ name: string }>;
      expect(tools.map((tool) => tool.name)).toContain('echo');
    });

    it('calls a tool and returns its structured result', async () => {
      const { message } = await rpc20260728(server.handler, 'tools/call', {
        name: 'echo',
        arguments: { message: 'hi' },
      });

      expect(message.result?.['isError']).toBeFalsy();
      expect(message.result?.['structuredContent']).toMatchObject({ echoed: 'hi' });
    });
  });

  describe('transparent auth server', () => {
    it('accepts a token signed by the test issuer', async () => {
      const issuer = await createTestJwtIssuer();
      const server = await createTestFetchServer({
        info: { name: 'harness-auth', version: '1.0.0' },
        apps: [HarnessApp],
        auth: { mode: 'transparent', provider: issuer.issuer, providerConfig: { jwks: issuer.jwks } },
      });
      const token = await issuer.sign({ scope: 'tickets:read' }, 'user-123');

      const { message } = await rpc20260728(
        server.handler,
        'tools/call',
        { name: 'echo', arguments: { message: 'hi' } },
        { headers: { authorization: `Bearer ${token}` } },
      );

      expect(message.result?.['structuredContent']).toMatchObject({ echoed: 'hi', clientId: 'user-123' });
    });
  });
});
