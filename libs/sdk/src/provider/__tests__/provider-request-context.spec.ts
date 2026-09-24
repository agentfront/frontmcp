import 'reflect-metadata';

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
});
