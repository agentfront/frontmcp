/**
 * Cache entries stay with their caller through the real tools:call-tool flow, using the auth
 * info the SDK actually builds (GHSA-r6v6-p4r8-p936).
 *
 * The SDK puts the caller in `authInfo.clientId` (the verified `sub`, or `anon:<uuid>` for an
 * anonymous session) and never in `authInfo.extra.sub`, so these calls go through a real
 * server rather than a hand-built flow context.
 */
import 'reflect-metadata';

import {
  App,
  FrontMcpInstance,
  LogLevel,
  STATELESS_SESSION_ID,
  Tool,
  ToolContext,
  type DirectAuthContext,
  type DirectMcpServer,
} from '@frontmcp/sdk';

import CachePlugin from '../cache.plugin';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));

let executions = 0;

@Tool({ name: 'get_profile', description: 'Returns the calling user profile', inputSchema: {}, cache: true })
class GetProfileTool extends ToolContext {
  async execute() {
    executions += 1;
    return { owner: this.getAuthInfo().clientId ?? 'nobody', execution: executions };
  }
}

@App({ id: 'profile', name: 'Profile', plugins: [CachePlugin.init({ type: 'memory' })], tools: [GetProfileTool] })
class ProfileApp {}

function caller(sub: string, sessionId = `session-${sub}`): DirectAuthContext {
  return { sessionId, user: { sub } };
}

async function getProfile(server: DirectMcpServer, authContext: DirectAuthContext): Promise<unknown> {
  const result = await server.callTool('get_profile', {}, { authContext });
  return result.structuredContent;
}

describe('CachePlugin — caller identity through tools:call-tool (GHSA-r6v6-p4r8-p936)', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    executions = 0;
    server = await FrontMcpInstance.createDirect({
      info: { name: 'cache-identity', version: '1.0.0' },
      apps: [ProfileApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('does not serve one user the entry cached for another', async () => {
    await getProfile(server, caller('alice'));

    await expect(getProfile(server, caller('bob'))).resolves.toMatchObject({ owner: 'bob', execution: 2 });
  });

  it('serves the same user their own cached entry', async () => {
    await getProfile(server, caller('alice'));

    await expect(getProfile(server, caller('alice'))).resolves.toMatchObject({ owner: 'alice', execution: 1 });
  });

  it('serves a user their entry from another of their sessions', async () => {
    await getProfile(server, caller('alice', 'session-one'));

    await expect(getProfile(server, caller('alice', 'session-two'))).resolves.toMatchObject({ execution: 1 });
  });

  it('keeps anonymous callers apart', async () => {
    await getProfile(server, caller('anon:first'));

    await expect(getProfile(server, caller('anon:second'))).resolves.toMatchObject({
      owner: 'anon:second',
      execution: 2,
    });
  });

  it('never shares an entry between stateless callers that carry no identity', async () => {
    const unidentifiedStateless = caller('', STATELESS_SESSION_ID);
    await getProfile(server, unidentifiedStateless);

    await expect(getProfile(server, unidentifiedStateless)).resolves.toMatchObject({ execution: 2 });
  });
});
