/**
 * Who a verified token speaks for (#1363): `this.auth.principal` tells a person from a machine (a client acting for
 * itself), the claims `auth_time`, `azp` and `client_id` are typed on the request's user, the auth options'
 * `principal` resolver decides where the provider marks machines another way, and an authorities rule can allow
 * people only through `user.principal`.
 */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { principal: this.auth.principal };
  }
}

@Tool({ name: 'people_only', inputSchema: {}, authorities: 'people' })
class PeopleOnlyTool extends ToolContext {
  async execute() {
    return { ran: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool, PeopleOnlyTool] })
class DeskApp {}

const ORIGIN = 'https://desk.example.com';
const IDP = 'https://idp.example.com';

const servers: TestFetchServer[] = [];
let privateKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
});

afterAll(async () => {
  await disposeServers(servers);
});

async function serverWith(extra: Record<string, unknown> = {}): Promise<TestFetchServer> {
  const server = await createTestFetchServer({
    info: { name: 'desk', version: '1.0.0' },
    apps: [DeskApp],
    auth: {
      mode: 'transparent',
      provider: IDP,
      expectedAudience: ORIGIN,
      providerConfig: { jwks: { keys: [jwk] } },
      ...extra,
    } as NonNullable<FrontMcpConfigInput['auth']>,
    authorities: { profiles: { people: { attributes: { match: { 'user.principal': 'person' } } } } },
  });
  servers.push(server);
  return server;
}

function idpToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(IDP)
    .setAudience(ORIGIN)
    .setIssuedAt(1_800_000_000)
    .setExpirationTime('10m')
    .sign(privateKey);
}

/** What a tool call answers, as its structured content, or its error. */
async function call(server: TestFetchServer, name: string, token: string) {
  const { message } = await rpc20260728(
    server.handler,
    'tools/call',
    { name, arguments: {} },
    { headers: { authorization: `Bearer ${token}` } },
  );
  const result = message.result as { structuredContent?: Record<string, unknown>; isError?: boolean } | undefined;
  return { result, error: message.error };
}

describe('the principal of a verified token', () => {
  it('names a person who signed in, with their client and when they signed in', async () => {
    const server = await serverWith();
    const token = await idpToken({ sub: 'user-42', azp: 'desk-app', auth_time: 1_799_999_000 });

    const { result } = await call(server, 'whoami', token);

    expect(result?.structuredContent).toEqual({
      principal: { kind: 'person', sub: 'user-42', clientId: 'desk-app', authTime: 1_799_999_000 },
    });
  });

  it('names a machine for a client-credentials token, though its sub is set', async () => {
    const server = await serverWith();
    const token = await idpToken({ sub: 'sync@clients', gty: 'client-credentials', azp: 'sync' });

    const { result } = await call(server, 'whoami', token);

    expect(result?.structuredContent).toEqual({
      principal: {
        kind: 'machine',
        sub: 'sync@clients',
        clientId: 'sync',
        authTime: 1_800_000_000,
        grantType: 'client_credentials',
      },
    });
  });

  it("follows the auth options' principal resolver, given the claims and the detected principal", async () => {
    const seen: unknown[] = [];
    const server = await serverWith({
      principal: (claims: Readonly<Record<string, unknown>>, detected: unknown) => {
        seen.push(detected);
        return String(claims['preferred_username']).startsWith('service-account-') ? { kind: 'machine' } : undefined;
      },
    });
    const serviceAccount = await idpToken({ sub: 'f81d4fae', azp: 'sync', preferred_username: 'service-account-sync' });

    const { result } = await call(server, 'whoami', serviceAccount);

    expect(result?.structuredContent).toEqual({
      principal: { kind: 'machine', sub: 'f81d4fae', clientId: 'sync', authTime: 1_800_000_000 },
    });
    expect(seen).toEqual([{ kind: 'person', sub: 'f81d4fae', clientId: 'sync', authTime: 1_800_000_000 }]);
  });

  it('serves the detected principal when the resolver throws', async () => {
    const server = await serverWith({
      principal: () => {
        throw new Error('directory unreachable');
      },
    });

    const { result } = await call(server, 'whoami', await idpToken({ sub: 'user-42' }));

    expect(result?.structuredContent).toEqual({
      principal: { kind: 'person', sub: 'user-42', authTime: 1_800_000_000 },
    });
  });

  it("lets an authorities profile allow people only, with match: { 'user.principal': 'person' }", async () => {
    const server = await serverWith();

    const person = await call(server, 'people_only', await idpToken({ sub: 'user-42' }));
    const machine = await call(server, 'people_only', await idpToken({ sub: 'sync', client_id: 'sync' }));

    expect(person.result?.structuredContent).toEqual({ ran: true });
    expect(JSON.stringify(machine)).toContain("'user.principal' expected 'person' but got 'machine'");
  });

  it('refuses a principal option that is not a function', async () => {
    await expect(serverWith({ principal: 'machine' })).rejects.toThrow('auth.principal must be a function');
  });
});
