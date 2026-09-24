import 'reflect-metadata';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  rpc20260728,
  type TestFetchServer,
  type TestJwtIssuer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../common';

interface ToolCallResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
  _meta?: Record<string, unknown>;
}

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    const auth = this.auth;
    return {
      sub: auth.user.sub,
      isAnonymous: auth.isAnonymous,
      scopes: [...auth.scopes],
      hasAdminRole: auth.hasRole('admin'),
    };
  }
}

@Tool({ name: 'delete_user', inputSchema: {}, authorities: 'admin' })
class DeleteUserTool extends ToolContext {
  async execute() {
    return { deleted: true };
  }
}

@Tool({ name: 'my_tickets', inputSchema: {}, authorities: 'authenticated' })
class MyTicketsTool extends ToolContext {
  async execute() {
    return { tickets: [] };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool, DeleteUserTool, MyTicketsTool] })
class DeskApp {}

describe('auth context under MCP 2026-07-28 with transparent auth', () => {
  let issuer: TestJwtIssuer;
  let server: TestFetchServer;
  let adminHeaders: Record<string, string>;
  let memberHeaders: Record<string, string>;

  beforeAll(async () => {
    issuer = await createTestJwtIssuer();
    server = await createTestFetchServer({
      info: { name: 'auth-context-20260728', version: '1.0.0' },
      apps: [DeskApp],
      auth: {
        mode: 'transparent',
        provider: issuer.issuer,
        providerConfig: { jwks: issuer.jwks },
        allowAnonymous: true,
      },
      authorities: {
        claimsMapping: { roles: 'roles' },
        profiles: {
          admin: { roles: { any: ['admin'] } },
          authenticated: { attributes: { conditions: [{ path: 'user.sub', op: 'exists', value: true }] } },
        },
      },
    });
    const adminToken = await issuer.sign({ scope: 'tickets:read tickets:write', roles: ['admin'] }, 'user-123');
    const memberToken = await issuer.sign({ scope: 'tickets:read', roles: ['member'] }, 'user-456');
    adminHeaders = { authorization: `Bearer ${adminToken}` };
    memberHeaders = { authorization: `Bearer ${memberToken}` };
  });

  async function callTool(name: string, headers: Record<string, string> = {}) {
    return rpc20260728(server.handler, 'tools/call', { name, arguments: {} }, { headers });
  }

  async function whoAmI(): Promise<Record<string, unknown>> {
    const { message } = await callTool('whoami', adminHeaders);
    return (message.result as ToolCallResult | undefined)?.structuredContent ?? {};
  }

  it('exposes the token subject as this.auth.user.sub and marks the caller as signed in', async () => {
    const identity = await whoAmI();

    expect({ sub: identity['sub'], isAnonymous: identity['isAnonymous'] }).toEqual({
      sub: 'user-123',
      isAnonymous: false,
    });
  });

  it('exposes the token scopes on this.auth.scopes', async () => {
    const identity = await whoAmI();

    expect(identity['scopes']).toEqual(['tickets:read', 'tickets:write']);
  });

  it('reports this.auth.hasRole for a role carried in the token', async () => {
    const identity = await whoAmI();

    expect(identity['hasAdminRole']).toBe(true);
  });

  it('lists a tool guarded by a role profile to a caller whose token carries the mapped role', async () => {
    const { message } = await rpc20260728(server.handler, 'tools/list', {}, { headers: adminHeaders });
    const tools = (message.result?.['tools'] as Array<{ name: string }> | undefined) ?? [];

    expect(tools.map((tool) => tool.name)).toContain('delete_user');
  });

  it('lets a caller whose token carries the mapped role call a role-guarded tool', async () => {
    const { message } = await callTool('delete_user', adminHeaders);

    expect(message.error).toBeUndefined();
    expect(message.result).toMatchObject({ structuredContent: { deleted: true } });
  });

  it('refuses a caller without the mapped role with the AUTHORITY_DENIED code', async () => {
    const { message } = await callTool('delete_user', memberHeaders);
    const result = message.result as ToolCallResult | undefined;
    const refusalCode = message.error?.code ?? result?._meta?.['code'];

    expect(refusalCode).not.toBe('SERVER_ERROR');
    expect([-32003, 'AUTHORITY_DENIED']).toContain(refusalCode);
  });

  it('refuses an anonymous caller a tool guarded by the authenticated profile', async () => {
    const { message } = await callTool('my_tickets');
    const result = message.result as ToolCallResult | undefined;

    expect(result?.structuredContent).toBeUndefined();
    expect(message.error !== undefined || result?.isError === true).toBe(true);
  });
});
