import 'reflect-metadata';

import { createClassProvider } from '../../__test-utils__/fixtures/provider.fixtures';
import { ProviderScope } from '../../common/metadata';
import { FrontMcpContext } from '../../context/frontmcp-context';
import { FRONTMCP_CONTEXT } from '../../context/frontmcp-context.provider';
import ProviderRegistry from '../provider.registry';

describe('ProviderRegistry.buildViews request-scoped context providers', () => {
  const sharedSessionKey = 'shared-session-key';

  let registry: ProviderRegistry;

  function createRequestContext(requestId: string, user: string, verifiedSessionId?: string): FrontMcpContext {
    return new FrontMcpContext({
      requestId,
      sessionId: sharedSessionKey,
      scopeId: 'request-context-scope',
      authInfo: {
        token: `token-of-${user}`,
        user: { iss: 'spec-issuer', sub: user },
        ...(verifiedSessionId ? { sessionId: verifiedSessionId } : {}),
      },
    });
  }

  beforeEach(async () => {
    registry = new ProviderRegistry([]);
    await registry.ready;
  });

  afterEach(() => {
    registry.dispose();
  });

  it('resolves the current request context when a later request reuses the same session key', async () => {
    const firstContext = createRequestContext('request-1', 'alice');
    const secondContext = createRequestContext('request-2', 'bob');

    await registry.buildViews(sharedSessionKey, new Map([[FRONTMCP_CONTEXT, firstContext]]));
    const secondViews = await registry.buildViews(sharedSessionKey, new Map([[FRONTMCP_CONTEXT, secondContext]]));

    const resolvedContext = secondViews.context.get(FRONTMCP_CONTEXT) as FrontMcpContext;
    expect(resolvedContext.requestId).toBe('request-2');
    expect(resolvedContext.authInfo.user?.sub).toBe('bob');
  });

  it('keeps a session provider built from session providers of the scope for the same session key', async () => {
    class ScopeSessionStore {}
    class AppSessionService {
      constructor(readonly store: ScopeSessionStore) {}
    }
    Reflect.defineMetadata('design:paramtypes', [ScopeSessionStore], AppSessionService);
    const scopeRegistry = new ProviderRegistry([
      createClassProvider(ScopeSessionStore, { name: 'ScopeSessionStore', scope: ProviderScope.CONTEXT }),
    ]);
    await scopeRegistry.ready;
    const appRegistry = new ProviderRegistry(
      [createClassProvider(AppSessionService, { name: 'AppSessionService', scope: ProviderScope.CONTEXT })],
      scopeRegistry,
    );
    await appRegistry.ready;

    async function appServiceFor(requestContext: FrontMcpContext): Promise<unknown> {
      const scopeViews = await scopeRegistry.buildViews(
        sharedSessionKey,
        new Map([[FRONTMCP_CONTEXT, requestContext]]),
      );
      const appViews = await appRegistry.buildViews(sharedSessionKey, scopeViews.context);
      return appViews.context.get(AppSessionService);
    }

    const firstService = await appServiceFor(createRequestContext('request-1', 'alice', sharedSessionKey));
    const secondService = await appServiceFor(createRequestContext('request-2', 'alice', sharedSessionKey));

    expect(secondService).toBe(firstService);
    appRegistry.dispose();
    scopeRegistry.dispose();
  });

  describe('a key the server did not verify for the request', () => {
    class CallerScratchpad {}
    let scratchRegistry: ProviderRegistry;

    beforeEach(async () => {
      scratchRegistry = new ProviderRegistry([
        createClassProvider(CallerScratchpad, { name: 'CallerScratchpad', scope: ProviderScope.CONTEXT }),
      ]);
      await scratchRegistry.ready;
    });

    afterEach(() => {
      scratchRegistry.dispose();
    });

    async function scratchpadFor(sessionKey: string, requestContext: FrontMcpContext): Promise<unknown> {
      const views = await scratchRegistry.buildViews(sessionKey, new Map([[FRONTMCP_CONTEXT, requestContext]]));
      return views.context.get(CallerScratchpad);
    }

    it('gives each request its own instances', async () => {
      const first = await scratchpadFor('anonymous', createRequestContext('request-1', 'alice'));
      const second = await scratchpadFor('anonymous', createRequestContext('request-2', 'bob'));

      expect(second).not.toBe(first);
      expect(scratchRegistry.getSessionCacheStats().size).toBe(0);
    });

    it('reuses the instances within one request', async () => {
      const requestContext = createRequestContext('request-1', 'alice');

      const first = await scratchpadFor('anonymous', requestContext);
      const second = await scratchpadFor('anonymous', requestContext);

      expect(second).toBe(first);
    });

    it('does not reuse the instances cached for a verified session under the same key', async () => {
      const owner = await scratchpadFor(sharedSessionKey, createRequestContext('request-1', 'alice', sharedSessionKey));
      const intruder = await scratchpadFor(sharedSessionKey, createRequestContext('request-2', 'mallory'));

      expect(intruder).not.toBe(owner);
    });

    it('does not keep instances across calls made without a request context', async () => {
      const first = (await scratchRegistry.buildViews(sharedSessionKey)).context.get(CallerScratchpad);
      const second = (await scratchRegistry.buildViews(sharedSessionKey)).context.get(CallerScratchpad);

      expect(second).not.toBe(first);
      expect(scratchRegistry.getSessionCacheStats().size).toBe(0);
    });

    it('rebuilds a provider that reads the request context once the caller is verified', async () => {
      // `http:request` builds the scope's views before `checkAuthorization` fills in the auth info, and the
      // later flows of the same request build them again. A provider that reads the request context must
      // see the verified caller there, not the instance built before verification.
      const Caller = Symbol('Caller');
      const callerRegistry = new ProviderRegistry([
        // Stands in for the scope's FrontMcpContextProvider; the request supplies the instance.
        {
          provide: FRONTMCP_CONTEXT,
          name: 'FrontMcpContext',
          scope: ProviderScope.CONTEXT,
          inject: () => [] as const,
          useFactory: () => {
            throw new Error('supplied by the request');
          },
        },
        {
          provide: Caller,
          name: 'Caller',
          scope: ProviderScope.CONTEXT,
          inject: () => [FRONTMCP_CONTEXT] as const,
          useFactory: (ctx: FrontMcpContext) => ({ sub: ctx.authInfo.user?.sub }),
        },
      ]);
      await callerRegistry.ready;
      const requestContext = new FrontMcpContext({
        requestId: 'request-1',
        sessionId: 'anonymous',
        scopeId: 'request-context-scope',
      });

      const beforeAuth = await callerRegistry.buildViews('anonymous', new Map([[FRONTMCP_CONTEXT, requestContext]]));
      requestContext.updateAuthInfo({ token: 'token-of-nour', user: { iss: 'spec-issuer', sub: 'nour' } });
      const afterAuth = await callerRegistry.buildViews('anonymous', new Map([[FRONTMCP_CONTEXT, requestContext]]));

      expect(beforeAuth.context.get(Caller)).toEqual({ sub: undefined });
      expect(afterAuth.context.get(Caller)).toEqual({ sub: 'nour' });
      callerRegistry.dispose();
    });
  });

  describe('with providerCaching: false', () => {
    class RequestScratchpad {}
    let uncachedRegistry: ProviderRegistry;

    beforeEach(async () => {
      uncachedRegistry = new ProviderRegistry(
        [createClassProvider(RequestScratchpad, { name: 'RequestScratchpad', scope: ProviderScope.CONTEXT })],
        undefined,
        { providerCaching: false },
      );
      await uncachedRegistry.ready;
    });

    afterEach(() => {
      uncachedRegistry.dispose();
    });

    async function scratchpadFor(requestContext: FrontMcpContext): Promise<unknown> {
      const views = await uncachedRegistry.buildViews(sharedSessionKey, new Map([[FRONTMCP_CONTEXT, requestContext]]));
      return views.context.get(RequestScratchpad);
    }

    it('builds the instances once per request', async () => {
      const requestContext = createRequestContext('request-1', 'alice', sharedSessionKey);

      const first = await scratchpadFor(requestContext);
      const second = await scratchpadFor(requestContext);

      expect(second).toBe(first);
    });

    it('does not keep them for the next request of a verified session', async () => {
      const first = await scratchpadFor(createRequestContext('request-1', 'alice', sharedSessionKey));
      const second = await scratchpadFor(createRequestContext('request-2', 'alice', sharedSessionKey));

      expect(second).not.toBe(first);
      expect(uncachedRegistry.getSessionCacheStats().size).toBe(0);
    });

    it("applies to the registries below it, such as an app's", async () => {
      class AppScratchpad {}
      const appRegistry = new ProviderRegistry(
        [createClassProvider(AppScratchpad, { name: 'AppScratchpad', scope: ProviderScope.CONTEXT })],
        uncachedRegistry,
      );
      await appRegistry.ready;
      const scratchpadOf = async (requestId: string) => {
        const requestContext = createRequestContext(requestId, 'alice', sharedSessionKey);
        const views = await appRegistry.buildViews(sharedSessionKey, new Map([[FRONTMCP_CONTEXT, requestContext]]));
        return views.context.get(AppScratchpad);
      };

      const first = await scratchpadOf('request-1');
      const second = await scratchpadOf('request-2');

      expect(appRegistry.isSessionCacheEnabled()).toBe(false);
      expect(second).not.toBe(first);
      appRegistry.dispose();
    });
  });

  it('reuses the instances of a session verified in the auth info when the request context has its own id', async () => {
    // A legacy SSE request carries its session in `?sessionId=`, so its request context gets a
    // per-request id while the entry flows key their providers by the session the server verified.
    class SessionScratchpad {}
    const sseRegistry = new ProviderRegistry([
      createClassProvider(SessionScratchpad, { name: 'SessionScratchpad', scope: ProviderScope.CONTEXT }),
    ]);
    await sseRegistry.ready;
    const sseRequest = (requestId: string) =>
      new FrontMcpContext({
        requestId,
        sessionId: `anon-${requestId}`,
        scopeId: 'request-context-scope',
        authInfo: { token: 'token-of-alice', extra: { sessionId: 'sse-session' } },
      });

    const first = await sseRegistry.buildViews('sse-session', new Map([[FRONTMCP_CONTEXT, sseRequest('request-1')]]));
    const second = await sseRegistry.buildViews('sse-session', new Map([[FRONTMCP_CONTEXT, sseRequest('request-2')]]));

    expect(second.context.get(SessionScratchpad)).toBe(first.context.get(SessionScratchpad));
    sseRegistry.dispose();
  });
});
