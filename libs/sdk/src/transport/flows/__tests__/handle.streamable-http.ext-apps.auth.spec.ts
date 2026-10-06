/**
 * An MCP App's `ui/callServerTool` runs as the caller whose session the widget is in (#766): a
 * signed-in caller's widget calls the tool as that caller, so `publicAccess`, which restricts only
 * anonymous callers, does not restrict it.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { App, LogLevel, Tool, ToolContext } from '../../../common';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

const IDP = 'https://idp.example.com';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub, isAnonymous: this.auth.isAnonymous, scopes: this.auth.scopes };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

describe('ui/callServerTool caller', () => {
  let node: http.Server;
  let base: string;
  let token: string;

  const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${base}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
    });

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

    const app = (await FrontMcpInstance.createHandler({
      info: { name: 'desk-ext-apps-auth', version: '1.0.0' },
      logging: { level: LogLevel.Off },
      apps: [DeskApp],
      auth: {
        mode: 'transparent',
        provider: IDP,
        providerConfig: { jwks: { keys: [jwk] } },
        allowAnonymous: true,
        publicAccess: { tools: [] },
      },
    })) as http.RequestListener;
    node = http.createServer(app);
    await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;

    token = await new SignJWT({ sub: 'nour', scope: 'tickets:read' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(IDP)
      .setAudience(base)
      .setExpirationTime('10m')
      .sign(privateKey);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => node.close(() => resolve()));
  });

  it('runs the tool as the signed-in caller', async () => {
    const initialized = await post({
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'host', version: '1.0.0' } },
    });
    const sessionId = initialized.headers.get('mcp-session-id') ?? '';
    await initialized.text();
    expect(sessionId).not.toBe('');

    const response = await post(
      { method: 'ui/callServerTool', params: { name: 'whoami', arguments: {} } },
      { 'mcp-session-id': sessionId },
    );
    const answer = await response.text();

    expect(answer).not.toContain('not available to anonymous callers');
    expect(answer).toContain('nour');
    expect(answer).toMatch(/isAnonymous\\?":false/);
    expect(answer).toContain('tickets:read');
  });
});
