/**
 * Session-scoped auth-provider credentials belong to the session the server verified, never to an
 * `mcp-session-id` a client merely sends.
 *
 * The accessor's credential context took `FrontMcpContext.sessionId` as the session, and the vault
 * keyed `session` credentials by it. Under MCP 2026-07-28 and on the stateless web transport that
 * is the header as sent, so a caller who sent another caller's id was served (and could replace)
 * that caller's credential.
 */
import 'reflect-metadata';

import {
  InMemoryAuthorizationVault,
  type AppCredential,
  type AuthorizationVault,
  type AuthProvidersAccessor,
  type CredentialFactoryContext,
  type CredentialProviderConfig,
} from '@frontmcp/auth';

import { authInfoFromAuthorization } from '../../../common/utils/auth-info.utils';
import { type FrontMcpContext } from '../../../context/frontmcp-context';
import { FrontMcpContextStorage } from '../../../context/frontmcp-context-storage';
import { createAuthProvidersProviders } from '../auth-providers.providers';

/** Just the two vault calls the accessor makes, keyed as the vault keys them. */
function memoryVault(): AuthorizationVault {
  const entries = new Map<string, AppCredential>();
  const vault = {
    addAppCredential: async (vaultKey: string, credential: AppCredential) => {
      entries.set(`${vaultKey}|${credential.appId}|${credential.providerId}`, credential);
    },
    getCredential: async (vaultKey: string, appId: string, providerId: string) =>
      entries.get(`${vaultKey}|${appId}|${providerId}`) ?? null,
  };
  return vault as unknown as AuthorizationVault;
}

/** The credential a factory hands out, and the session id each factory call was given. */
const issued = { next: '', sessions: [] as string[] };

const github: CredentialProviderConfig = {
  name: 'github',
  scope: 'session',
  loading: 'lazy',
  factory: async (context: CredentialFactoryContext) => {
    issued.sessions.push(context.sessionId);
    return { type: 'bearer', token: issued.next };
  },
};

const logger = {
  child: () => logger,
  debug: () => undefined,
  verbose: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

type Def = { useFactory: (...args: unknown[]) => unknown };

/** An accessor built for the request context `ctx`, as the SDK builds one for each request. */
function accessorFor(ctx: FrontMcpContext, vaultBackend: AuthorizationVault): AuthProvidersAccessor {
  const [registryDef, vaultDef, cacheDef, loaderDef, accessorDef] = createAuthProvidersProviders(
    { providers: [github] },
    vaultBackend,
  ) as unknown as Def[];
  return accessorDef.useFactory(
    registryDef.useFactory(),
    vaultDef.useFactory(logger),
    cacheDef.useFactory(),
    loaderDef.useFactory(logger),
    ctx,
    logger,
  ) as AuthProvidersAccessor;
}

/** The context of an HTTP request that sent `sessionId` and that session verification did not accept. */
async function requestContext(sub: string, sessionId?: string): Promise<FrontMcpContext> {
  const storage = new FrontMcpContextStorage();
  const headers = sessionId ? { 'mcp-session-id': sessionId } : {};
  const ctx = await storage.runForHttpRequest({ headers }, 'scope', () => storage.getStoreOrThrow());
  ctx.updateAuthInfo(authInfoFromAuthorization({ token: 'token', user: { iss: 'https://idp.example.com', sub } }));
  return ctx;
}

async function tokenFor(accessor: AuthProvidersAccessor, issue: string): Promise<string | undefined> {
  issued.next = issue;
  const resolved = await accessor.get('github');
  return (resolved?.credential as { token?: string } | undefined)?.token;
}

beforeEach(() => {
  issued.sessions.length = 0;
});

describe('session-scoped auth-provider credentials of callers without a verified session', () => {
  it('are not served to a caller that sends another caller’s mcp-session-id', async () => {
    const vault = memoryVault();
    await tokenFor(accessorFor(await requestContext('alice', 'victim-session'), vault), 'gh-alice');

    const served = await tokenFor(accessorFor(await requestContext('mallory', 'victim-session'), vault), 'gh-mallory');

    expect(served).toBe('gh-mallory');
  });

  it('are not replaced by a caller that sends another caller’s mcp-session-id', async () => {
    const vault = memoryVault();
    await tokenFor(accessorFor(await requestContext('alice', 'victim-session'), vault), 'gh-alice');
    issued.next = 'gh-mallory';
    await accessorFor(await requestContext('mallory', 'victim-session'), vault).refresh('github');

    expect(await tokenFor(accessorFor(await requestContext('alice', 'victim-session'), vault), 'unused')).toBe(
      'gh-alice',
    );
  });

  it('never give the credential factory the session id the client sent', async () => {
    await tokenFor(accessorFor(await requestContext('alice', 'victim-session'), memoryVault()), 'gh-alice');

    expect(issued.sessions).toEqual(['principal:alice']);
  });

  it('last across a signed-in caller’s requests', async () => {
    const vault = memoryVault();
    await tokenFor(accessorFor(await requestContext('alice'), vault), 'gh-alice');

    expect(await tokenFor(accessorFor(await requestContext('alice'), vault), 'unused')).toBe('gh-alice');
  });

  it('leave no vault record for an anonymous caller without a verified session', async () => {
    // The real vault, not the stub above: it stores a credential only in an entry `create()` made,
    // and nothing creates one for the per-request `unidentified:` id, so nothing is kept or grows.
    const vault = new InMemoryAuthorizationVault();
    const store = (vault as unknown as { memoryAdapter: { keys(pattern: string): Promise<string[]> } }).memoryAdapter;
    const before = await store.keys('*');

    const first = await tokenFor(accessorFor(await requestContext('anon:1'), vault), 'gh-first');
    const second = await tokenFor(accessorFor(await requestContext('anon:2'), vault), 'gh-second');

    expect([first, second]).toEqual(['gh-first', 'gh-second']);
    expect(issued.sessions).toHaveLength(2);
    expect(issued.sessions.every((session) => session.startsWith('unidentified:'))).toBe(true);
    expect(new Set(issued.sessions).size).toBe(2);
    expect(await store.keys('*')).toEqual(before);
  });

  it('are never shared between anonymous callers', async () => {
    const vault = memoryVault();
    await tokenFor(accessorFor(await requestContext('anon:1', 'shared-session'), vault), 'gh-first');

    const second = await tokenFor(accessorFor(await requestContext('anon:2', 'shared-session'), vault), 'gh-second');

    expect(second).toBe('gh-second');
    expect(issued.sessions.some((session) => session.includes('shared-session'))).toBe(false);
  });
});

describe('session-scoped auth-provider credentials of a verified session', () => {
  it('stay with that session', async () => {
    const vault = memoryVault();
    const session = (sub: string, sessionId: string) =>
      new FrontMcpContextStorage().run({ sessionId, scopeId: 'scope', authInfo: { sessionId, clientId: sub } }, () =>
        new FrontMcpContextStorage().getStoreOrThrow(),
      ) as FrontMcpContext;
    await tokenFor(accessorFor(session('alice', 'session-a'), vault), 'gh-a');

    expect({
      same: await tokenFor(accessorFor(session('alice', 'session-a'), vault), 'unused'),
      other: await tokenFor(accessorFor(session('alice', 'session-b'), vault), 'gh-b'),
    }).toEqual({ same: 'gh-a', other: 'gh-b' });
    expect(issued.sessions).toEqual(['session-a', 'session-b']);
  });
});
