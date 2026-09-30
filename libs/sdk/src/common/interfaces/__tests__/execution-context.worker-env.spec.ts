/**
 * Issue #646 — a Worker's non-string bindings (KV, D1, R2, …) were forwarded on
 * the request but nothing exposed them to tools. `workerEnv` reads them from the
 * request context.
 */

import 'reflect-metadata';

import { ExecutionContextBase, ServerRequestTokens } from '../../../common';
import { FrontMcpContext } from '../../../context/frontmcp-context';
import { FrontMcpContextStorage } from '../../../context/frontmcp-context-storage';

class TestContext extends ExecutionContextBase {
  constructor(context?: FrontMcpContext) {
    super({
      providers: {
        get: () => {
          if (!context) throw new Error('no context');
          return context;
        },
      } as never,
      logger: { child: () => ({}) } as never,
      authInfo: {},
    });
  }
}

describe('ExecutionContextBase.workerEnv (#646)', () => {
  it('exposes the bindings object of the current request', () => {
    const kv = { get: jest.fn() };
    const context = new FrontMcpContext({ sessionId: 's1', scopeId: 'scope', platformEnv: { MY_KV: kv, NAME: 'x' } });

    const env = new TestContext(context).workerEnv;

    expect(env?.['MY_KV']).toBe(kv);
    expect(env?.['NAME']).toBe('x');
  });

  it('is undefined when the runtime supplies no bindings (Node)', () => {
    const context = new FrontMcpContext({ sessionId: 's1', scopeId: 'scope' });
    expect(new TestContext(context).workerEnv).toBeUndefined();
  });

  it('is undefined outside a request context instead of throwing', () => {
    expect(new TestContext().workerEnv).toBeUndefined();
  });

  it('is populated end to end from the tokenized web request', () => {
    const storage = new FrontMcpContextStorage();
    const kv = { get: jest.fn() };
    const request = { headers: {}, [ServerRequestTokens.webEnv]: { MY_KV: kv } };

    storage.runForHttpRequest(request, 'scope', () => {
      const ctx = storage.getStoreOrThrow();
      expect(new TestContext(ctx).workerEnv?.['MY_KV']).toBe(kv);
    });
  });
});
