import 'reflect-metadata';

import { decodeJwt } from 'jose';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  rpc20260728,
  type TestFetchServer,
  type TestJwtIssuer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { connect } from '../../direct/connect';

@Tool({ name: 'token_expiry', inputSchema: {} })
class TokenExpiryTool extends ToolContext {
  async execute() {
    return { expiresAt: this.getAuthInfo().expiresAt ?? null };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [TokenExpiryTool] })
class DeskApp {}

const AUDIENCE = 'desk-api';

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> } | undefined)?.structuredContent ?? {};
}

describe('authInfo.expiresAt is the token expiry in epoch seconds', () => {
  let issuer: TestJwtIssuer;
  let config: FrontMcpConfigInput;
  let token: string;
  let tokenExp: number | undefined;

  beforeAll(async () => {
    issuer = await createTestJwtIssuer();
    config = {
      info: { name: 'auth-info-expires-at', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
      auth: {
        mode: 'transparent',
        provider: issuer.issuer,
        providerConfig: { jwks: issuer.jwks },
        expectedAudience: AUDIENCE,
      },
    };
    token = await issuer.sign({ aud: AUDIENCE }, 'alice');
    tokenExp = decodeJwt(token).exp;
  });

  it('over HTTP (MCP 2026-07-28)', async () => {
    const server: TestFetchServer = await createTestFetchServer(config);
    try {
      const { message } = await rpc20260728(
        server.handler,
        'tools/call',
        { name: 'token_expiry', arguments: {} },
        { headers: { authorization: `Bearer ${token}` } },
      );

      expect(tokenExp).toEqual(expect.any(Number));
      expect(structured(message.result)).toEqual({ expiresAt: tokenExp });
    } finally {
      await disposeServers([server]);
    }
  });

  it('through connect() with an authToken', async () => {
    const client = await connect(config, { authToken: token });
    try {
      expect(structured(await client.callTool('token_expiry', {}))).toEqual({ expiresAt: tokenExp });
    } finally {
      await client.close();
    }
  });
});
