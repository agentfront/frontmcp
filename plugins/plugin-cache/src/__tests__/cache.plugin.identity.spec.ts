/**
 * Cache entries are keyed to the caller, not just to the tool and its arguments
 * (GHSA-r6v6-p4r8-p936).
 *
 * The key was `hashObject({ tool: tool.fullName, input: toolContext.input })` — no caller
 * identity anywhere in it. Any tool whose output depends on who is asking (a profile, an
 * account balance, a tenant's records, anything filtered by the caller's own permissions)
 * served the first caller's response to every later one. `getProfile({})` is the same key for
 * everybody.
 *
 * Read and write built the key at two separate call sites, so they must also be shown to
 * agree; a key that differs between them silently disables the cache instead.
 */
import 'reflect-metadata';

import CachePlugin from '../cache.plugin';
import { CacheStoreToken } from '../cache.symbol';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));

function createHarness(options: { keyByIdentity?: boolean } = {}) {
  const plugin = new CachePlugin({ type: 'memory', toolPatterns: ['test:*'], ...options });
  const store = {
    getValue: jest.fn().mockResolvedValue(undefined),
    setValue: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  (plugin as any).get = (token: unknown) => {
    if (token === CacheStoreToken) return store;
    return { getStore: () => ({ metadata: {} }) };
  };
  return { plugin, store };
}

function createFlowCtx(authInfo: unknown, sessionId = 'session-1') {
  return {
    state: {
      tool: {
        fullName: 'test:getProfile',
        name: 'test:getProfile',
        safeParseOutput: () => ({ success: true }),
      },
      toolContext: {
        metadata: { cache: true },
        input: {},
        output: { email: 'someone@example.com' },
        authInfo,
        tryGetContext: () => ({ sessionId, authInfo }),
        respond: jest.fn(),
      },
    },
  } as any;
}

// The SAME clientId with different subjects: varying both would let the test pass even if
// the implementation keyed only by clientId.
const USER_A = { extra: { sub: 'user-a' }, clientId: 'shared-client' };
const USER_B = { extra: { sub: 'user-b' }, clientId: 'shared-client' };

describe('CachePlugin — caller identity in the key (GHSA-r6v6-p4r8-p936)', () => {
  it('does not serve one user a value cached for another', async () => {
    const { plugin, store } = createHarness();

    await plugin.willWriteCache(createFlowCtx(USER_A));
    expect(store.setValue).toHaveBeenCalledTimes(1);
    const keyForA = store.setValue.mock.calls[0][0];

    const ctxB = createFlowCtx(USER_B);
    await plugin.willReadCache(ctxB);
    const keyReadForB = store.getValue.mock.calls[0][0];

    expect(keyReadForB).not.toBe(keyForA);
    expect(ctxB.state.toolContext.respond).not.toHaveBeenCalled();
  });

  it('uses the same key on read and write for one caller, so the cache still works', async () => {
    const { plugin, store } = createHarness();

    await plugin.willWriteCache(createFlowCtx(USER_A));
    await plugin.willReadCache(createFlowCtx(USER_A));

    expect(store.getValue.mock.calls[0][0]).toBe(store.setValue.mock.calls[0][0]);
  });

  it('separates two anonymous sessions', async () => {
    const { plugin, store } = createHarness();

    await plugin.willWriteCache(createFlowCtx(undefined, 'session-1'));
    await plugin.willReadCache(createFlowCtx(undefined, 'session-2'));

    expect(store.getValue.mock.calls[0][0]).not.toBe(store.setValue.mock.calls[0][0]);
  });

  it('still separates different inputs for the same caller', async () => {
    const { plugin, store } = createHarness();

    const first = createFlowCtx(USER_A);
    first.state.toolContext.input = { id: 1 };
    const second = createFlowCtx(USER_A);
    second.state.toolContext.input = { id: 2 };

    await plugin.willWriteCache(first);
    await plugin.willWriteCache(second);

    expect(store.setValue.mock.calls[0][0]).not.toBe(store.setValue.mock.calls[1][0]);
  });

  it('shares the key across callers only when identity keying is turned off', async () => {
    const { plugin, store } = createHarness({ keyByIdentity: false });

    await plugin.willWriteCache(createFlowCtx(USER_A));
    await plugin.willReadCache(createFlowCtx(USER_B));

    expect(store.getValue.mock.calls[0][0]).toBe(store.setValue.mock.calls[0][0]);
  });

  it('gives one subject the same key across different sessions', async () => {
    const { plugin, store } = createHarness();

    await plugin.willWriteCache(createFlowCtx(USER_A, 'session-1'));
    await plugin.willWriteCache(createFlowCtx(USER_A, 'session-2'));

    expect(store.setValue.mock.calls[0][0]).toBe(store.setValue.mock.calls[1][0]);
  });

  it('falls back to the client id when no subject is present', async () => {
    const { plugin, store } = createHarness();

    await plugin.willWriteCache(createFlowCtx({ clientId: 'client-a' }));
    await plugin.willWriteCache(createFlowCtx({ clientId: 'client-b' }));

    expect(store.setValue.mock.calls[0][0]).not.toBe(store.setValue.mock.calls[1][0]);
  });

  it('gives a call with no identity at all its own key rather than a shared one', async () => {
    const { plugin, store } = createHarness();

    // No authInfo and no session: two such calls must not collide, because a shared
    // identity-less bucket would serve one caller's response to another.
    const first = createFlowCtx(undefined, '');
    first.state.toolContext.tryGetContext = () => ({ sessionId: undefined, authInfo: undefined });
    const second = createFlowCtx(undefined, '');
    second.state.toolContext.tryGetContext = () => ({ sessionId: undefined, authInfo: undefined });

    await plugin.willWriteCache(first);
    await plugin.willWriteCache(second);

    expect(store.setValue.mock.calls[0][0]).not.toBe(store.setValue.mock.calls[1][0]);
  });

  it('keys array and nested-object arguments stably, whatever the key order', async () => {
    const { plugin, store } = createHarness();

    const a = createFlowCtx(USER_A);
    a.state.toolContext.input = { filters: ['x', 'y'], page: { size: 10, index: 1 } };
    const b = createFlowCtx(USER_A);
    // Same data, different key insertion order: the key must not depend on it.
    b.state.toolContext.input = { page: { index: 1, size: 10 }, filters: ['x', 'y'] };
    const c = createFlowCtx(USER_A);
    // Array order IS meaningful, so this must differ.
    c.state.toolContext.input = { filters: ['y', 'x'], page: { size: 10, index: 1 } };

    await plugin.willWriteCache(a);
    await plugin.willWriteCache(b);
    await plugin.willWriteCache(c);

    expect(store.setValue.mock.calls[0][0]).toBe(store.setValue.mock.calls[1][0]);
    expect(store.setValue.mock.calls[2][0]).not.toBe(store.setValue.mock.calls[0][0]);
  });

  it('produces a fixed-length digest rather than a concatenation of the inputs', async () => {
    const { plugin, store } = createHarness();

    const ctx = createFlowCtx(USER_A);
    ctx.state.toolContext.input = { note: 'a'.repeat(5000) };
    await plugin.willWriteCache(ctx);

    const key = store.setValue.mock.calls[0][0] as string;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('user-a');
  });
});
