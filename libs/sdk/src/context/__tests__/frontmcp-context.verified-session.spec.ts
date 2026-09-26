/** `FrontMcpContext.verifiedSessionId` tells a verified session from stateless and per-request ids (#597). */
import { type Authorization } from '../../common/types/auth/session.types';
import { authInfoFromAuthorization } from '../../common/utils/auth-info.utils';
import { STATELESS_SESSION_ID } from '../../transport/transport.types';
import { FrontMcpContext } from '../frontmcp-context';
import { FrontMcpContextStorage } from '../frontmcp-context-storage';

function authorization(verifiedSessionId?: string): Authorization {
  return {
    token: 'token',
    user: { sub: 'alice', iss: 'https://auth.example.com' },
    ...(verifiedSessionId ? { session: { id: verifiedSessionId } } : {}),
  };
}

function contextFor(sessionId: string, verifiedSessionId?: string): FrontMcpContext {
  const context = new FrontMcpContext({ sessionId, scopeId: 'scope' });
  context.updateAuthInfo(authInfoFromAuthorization(authorization(verifiedSessionId)));
  return context;
}

describe('FrontMcpContext.verifiedSessionId', () => {
  it('is the session id when session verification authorized it for the request', () => {
    expect(contextFor('session-1', 'session-1').verifiedSessionId).toBe('session-1');
  });

  it('is the session id an in-process transport assigned in the auth info', () => {
    const context = new FrontMcpContext({
      sessionId: 'direct-1',
      scopeId: 'scope',
      authInfo: { sessionId: 'direct-1' },
    });

    expect(context.verifiedSessionId).toBe('direct-1');
  });

  it('is undefined for the placeholder a request without mcp-session-id runs under', async () => {
    const storage = new FrontMcpContextStorage();
    const context = await storage.runForHttpRequest({ headers: {} }, 'scope', () => storage.getStoreOrThrow());
    context.updateAuthInfo(authInfoFromAuthorization(authorization()));

    expect(context.sessionId).toMatch(/^anon:/);
    expect(context.verifiedSessionId).toBeUndefined();
  });

  it('is undefined when the id the client sent is not the session the server verified', () => {
    expect(contextFor('session-of-someone-else', 'session-1').verifiedSessionId).toBeUndefined();
    expect(contextFor('session-of-someone-else').verifiedSessionId).toBeUndefined();
  });

  it('is undefined for the shared stateless session id, even when the auth info repeats it', () => {
    const context = new FrontMcpContext({
      sessionId: STATELESS_SESSION_ID,
      scopeId: 'scope',
      authInfo: { sessionId: STATELESS_SESSION_ID },
    });

    expect(context.verifiedSessionId).toBeUndefined();
  });

  it('is undefined before any auth info is known', () => {
    expect(new FrontMcpContext({ sessionId: 'session-1', scopeId: 'scope' }).verifiedSessionId).toBeUndefined();
  });
});
