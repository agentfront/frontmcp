/**
 * `throttle.global` counts the OAuth and discovery endpoints (#766): each of their flows runs an
 * `acquireQuota` stage after `checkIpFilter`, so a client cannot hammer `/oauth/*` or
 * `/.well-known/*` past the server's limit.
 */
import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext } from '../../common';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

const ORIGIN = 'https://desk.example.com';
const servers: TestFetchServer[] = [];

afterAll(async () => {
  await disposeServers(servers);
});

describe('throttle.global on OAuth and discovery routes', () => {
  it.each([
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/.well-known/jwks.json',
  ])('answers %s 429 once the limit is reached', async (path) => {
    const server = await createTestFetchServer({
      info: { name: 'desk', version: '1.0.0' },
      apps: [DeskApp],
      throttle: { enabled: true, global: { maxRequests: 1, windowMs: 60_000, partitionBy: 'global' } },
    });
    servers.push(server);

    const first = await server.handler(new Request(`${ORIGIN}${path}`));
    const second = await server.handler(new Request(`${ORIGIN}${path}`));

    expect(first.status).not.toBe(429);
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBeTruthy();
  });

  it('answers /oauth/token 429 once the limit is reached', async () => {
    const server = await createTestFetchServer({
      info: { name: 'desk', version: '1.0.0' },
      apps: [DeskApp],
      auth: { mode: 'local' },
      throttle: { enabled: true, global: { maxRequests: 1, windowMs: 60_000, partitionBy: 'global' } },
    });
    servers.push(server);
    const tokenRequest = () =>
      server.handler(
        new Request(`${ORIGIN}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=authorization_code&code=unknown&code_verifier=v&client_id=c&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcb',
        }),
      );

    const first = await tokenRequest();
    const second = await tokenRequest();

    expect(first.status).not.toBe(429);
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBeTruthy();
  });

  it('counts a function partition too, resolved with the caller IP and no verified identity', async () => {
    const partitionInputs: Array<{ userId?: string }> = [];
    const server = await createTestFetchServer({
      info: { name: 'desk', version: '1.0.0' },
      apps: [DeskApp],
      throttle: {
        enabled: true,
        global: {
          maxRequests: 1,
          windowMs: 60_000,
          partitionBy: (partitionContext) => {
            partitionInputs.push({ userId: partitionContext.userId });
            return `ip:${partitionContext.clientIp ?? 'unknown'}`;
          },
        },
      },
    });
    servers.push(server);

    const first = await server.handler(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`));
    const second = await server.handler(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`));

    expect(first.status).not.toBe(429);
    expect(second.status).toBe(429);
    expect(partitionInputs.length).toBeGreaterThan(0);
    expect(partitionInputs.every((input) => input.userId === undefined)).toBe(true);
  });

  it('still leaves a session or user partition to the MCP endpoint, where the caller is verified', async () => {
    const server = await createTestFetchServer({
      info: { name: 'desk', version: '1.0.0' },
      apps: [DeskApp],
      throttle: { enabled: true, global: { maxRequests: 1, windowMs: 60_000, partitionBy: 'userId' } },
    });
    servers.push(server);

    const first = await server.handler(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`));
    const second = await server.handler(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`));

    expect(first.status).not.toBe(429);
    expect(second.status).not.toBe(429);
  });
});
