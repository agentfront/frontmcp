import 'reflect-metadata';

import { createTestJwtIssuer, type TestJwtIssuer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { PublicMcpError, UnauthorizedError } from '../../errors';
import { connect } from '../connect';

@Tool({ name: 'who_is_calling', inputSchema: {} })
class WhoIsCallingTool extends ToolContext {
  async execute() {
    const authInfo = this.getAuthInfo();
    return { sub: authInfo.user?.sub ?? null, token: authInfo.token ?? null, roles: this.auth.roles };
  }
}

@Tool({ name: 'refund_order', inputSchema: {}, authorities: 'admin' })
class RefundOrderTool extends ToolContext {
  async execute() {
    return { refunded: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoIsCallingTool, RefundOrderTool] })
class DeskApp {}

const AUDIENCE = 'desk-cli';

function config(auth: FrontMcpConfigInput['auth']): FrontMcpConfigInput {
  return {
    info: { name: 'connect-auth-token', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    auth,
    authorities: {
      claimsMapping: { roles: 'realm.roles' },
      profiles: { admin: { roles: { any: ['admin'] } } },
    },
  };
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent: Record<string, unknown> }).structuredContent;
}

describe('connect() with an authToken', () => {
  let issuer: TestJwtIssuer;
  let transparent: FrontMcpConfigInput;

  beforeAll(async () => {
    issuer = await createTestJwtIssuer();
    transparent = config({
      mode: 'transparent',
      provider: issuer.issuer,
      providerConfig: { jwks: issuer.jwks },
      expectedAudience: AUDIENCE,
    });
  });

  it('makes the verified claims the caller, so an authorities rule sees their roles through claimsMapping', async () => {
    const token = await issuer.sign({ aud: AUDIENCE, realm: { roles: ['admin'] } }, 'alice');
    const client = await connect(transparent, { authToken: token, mode: 'cli' });
    try {
      expect(structured(await client.callTool('who_is_calling', {}))).toEqual({
        sub: 'alice',
        token,
        roles: ['admin'],
      });
      expect(structured(await client.callTool('refund_order', {}))).toEqual({ refunded: true });
    } finally {
      await client.close();
    }
  });

  it('denies an authorities rule the verified caller does not meet', async () => {
    const token = await issuer.sign({ aud: AUDIENCE, realm: { roles: ['viewer'] } }, 'bob');
    const client = await connect(transparent, { authToken: token, mode: 'cli' });
    try {
      const result = (await client.callTool('refund_order', {})) as { isError?: boolean };
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('prefers the verified claims over session.user', async () => {
    const token = await issuer.sign({ aud: AUDIENCE, realm: { roles: ['viewer'] } }, 'bob');
    const client = await connect(transparent, {
      authToken: token,
      session: { user: { sub: 'mallory', realm: { roles: ['admin'] } } },
    });
    try {
      expect(structured(await client.callTool('who_is_calling', {}))).toMatchObject({ sub: 'bob', roles: ['viewer'] });
    } finally {
      await client.close();
    }
  });

  it('fails the connection for a token the server did not sign', async () => {
    const stranger = await createTestJwtIssuer(issuer.issuer);
    const token = await stranger.sign({ aud: AUDIENCE, realm: { roles: ['admin'] } }, 'alice');

    await expect(connect(transparent, { authToken: token })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('fails the connection for a token minted for another audience', async () => {
    const token = await issuer.sign({ aud: 'another-service', realm: { roles: ['admin'] } }, 'alice');

    await expect(connect(transparent, { authToken: token })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('fails the connection for a token without the scopes the server requires', async () => {
    const scoped = config({
      mode: 'transparent',
      provider: issuer.issuer,
      providerConfig: { jwks: issuer.jwks },
      expectedAudience: AUDIENCE,
      requiredScopes: ['desk:use'],
    });
    const token = await issuer.sign({ aud: AUDIENCE, scope: 'desk:read' }, 'alice');

    const failure = await connect(scoped, { authToken: token }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PublicMcpError);
    expect((failure as PublicMcpError).statusCode).toBe(403);
  });

  it('passes an opaque token to the tools of a public server, which verifies none', async () => {
    const client = await connect(config({ mode: 'public' }), { authToken: 'opaque-token' });
    try {
      expect(structured(await client.callTool('who_is_calling', {}))).toEqual({
        sub: null,
        token: 'opaque-token',
        roles: [],
      });
    } finally {
      await client.close();
    }
  });
});
