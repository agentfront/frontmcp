import 'reflect-metadata';

import { createClassProvider } from '../../__test-utils__/fixtures/provider.fixtures';
import { ProviderScope } from '../../common/metadata';
import { FrontMcpContext } from '../../context/frontmcp-context';
import { FRONTMCP_CONTEXT } from '../../context/frontmcp-context.provider';
import ProviderRegistry from '../provider.registry';

describe('ProviderRegistry.buildViews request-scoped context providers', () => {
  const sharedSessionKey = 'shared-session-key';

  let registry: ProviderRegistry;

  function createRequestContext(requestId: string, user: string): FrontMcpContext {
    return new FrontMcpContext({
      requestId,
      sessionId: sharedSessionKey,
      scopeId: 'request-context-scope',
      authInfo: { token: `token-of-${user}`, user: { iss: 'spec-issuer', sub: user } },
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

    const firstService = await appServiceFor(createRequestContext('request-1', 'alice'));
    const secondService = await appServiceFor(createRequestContext('request-2', 'alice'));

    expect(secondService).toBe(firstService);
    appRegistry.dispose();
    scopeRegistry.dispose();
  });
});
