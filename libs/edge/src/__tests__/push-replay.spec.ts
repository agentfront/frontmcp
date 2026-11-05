import {
  createDurableObjectPushReplayStore,
  DEFAULT_PUSH_REPLAY_BINDING,
  PushReplayDurableObject,
  resolvePushReplayStore,
} from '../push-replay';

/** A Durable Object's `state.storage`, as far as the replay object uses it; `delete` takes 128 keys at most, as on Cloudflare. */
class FakeDurableObjectStorage {
  readonly entries = new Map<string, unknown>();

  async list(): Promise<Map<string, unknown>> {
    return new Map(this.entries);
  }

  async put(key: string, value: unknown): Promise<void> {
    this.entries.set(key, value);
  }

  async delete(keys: string[]): Promise<number> {
    if (keys.length > 128) throw new Error('delete() takes at most 128 keys');
    return keys.filter((key) => this.entries.delete(key)).length;
  }
}

/** A Durable Object namespace: one object per name, as on Cloudflare, whichever isolate asks. */
function fakeNamespace(): {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
  storageOf(name: string): FakeDurableObjectStorage | undefined;
} {
  const objects = new Map<string, { replayObject: PushReplayDurableObject; storage: FakeDurableObjectStorage }>();
  return {
    idFromName: (name) => `id:${name}`,
    get(id) {
      const key = String(id);
      let entry = objects.get(key);
      if (!entry) {
        const storage = new FakeDurableObjectStorage();
        entry = { replayObject: new PushReplayDurableObject({ storage }), storage };
        objects.set(key, entry);
      }
      const { replayObject } = entry;
      return { fetch: (request) => replayObject.fetch(request) };
    },
    storageOf: (name) => objects.get(`id:${name}`)?.storage,
  };
}

const claimRequest = (body: unknown) =>
  new Request('https://push-replay.frontmcp.internal/claim', { method: 'POST', body: JSON.stringify(body) });

describe('PushReplayDurableObject', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records a key once and refuses it while it is unexpired', async () => {
    const replayObject = new PushReplayDurableObject({ storage: new FakeDurableObjectStorage() });

    const first = await replayObject.fetch(claimRequest({ key: 'jti-hash', ttlMs: 60_000 }));
    const replayed = await replayObject.fetch(claimRequest({ key: 'jti-hash', ttlMs: 60_000 }));

    expect(await first.json()).toEqual({ claimed: true });
    expect(await replayed.json()).toEqual({ claimed: false });
  });

  it('records a key again once its TTL passed, and drops the expired keys as it claims', async () => {
    const storage = new FakeDurableObjectStorage();
    const replayObject = new PushReplayDurableObject({ storage });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await replayObject.fetch(claimRequest({ key: 'short-lived', ttlMs: 1_000 }));
    await replayObject.fetch(claimRequest({ key: 'long-lived', ttlMs: 600_000 }));

    clock.mockReturnValue(1_000_000 + 1_000);
    const atExpiry = await replayObject.fetch(claimRequest({ key: 'short-lived', ttlMs: 1_000 }));
    clock.mockReturnValue(1_000_000 + 1_001);
    const pastExpiry = await replayObject.fetch(claimRequest({ key: 'short-lived', ttlMs: 1_000 }));

    expect(await atExpiry.json()).toEqual({ claimed: false });
    expect(await pastExpiry.json()).toEqual({ claimed: true });
    expect([...storage.entries.keys()].sort()).toEqual(['long-lived', 'short-lived']);
    expect(storage.entries.get('short-lived')).toBe(1_000_000 + 1_001 + 1_000);
  });

  it('drops more expired keys than one delete takes', async () => {
    const storage = new FakeDurableObjectStorage();
    for (let index = 0; index < 300; index++) storage.entries.set(`expired-${index}`, 1);
    const replayObject = new PushReplayDurableObject({ storage });

    const response = await replayObject.fetch(claimRequest({ key: 'fresh', ttlMs: 60_000 }));

    expect(await response.json()).toEqual({ claimed: true });
    expect([...storage.entries.keys()]).toEqual(['fresh']);
  });

  it.each([
    ['no key', { ttlMs: 1_000 }],
    ['an empty key', { key: '', ttlMs: 1_000 }],
    ['a negative TTL', { key: 'jti-hash', ttlMs: -1 }],
    ['a TTL that is not a number', { key: 'jti-hash', ttlMs: '60000' }],
  ])('answers 400 to a claim with %s', async (_label, body) => {
    const storage = new FakeDurableObjectStorage();
    const replayObject = new PushReplayDurableObject({ storage });

    const response = await replayObject.fetch(claimRequest(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_claim' });
    expect(storage.entries.size).toBe(0);
  });
});

describe('createDurableObjectPushReplayStore', () => {
  it('refuses, from a second isolate, a key the first isolate claimed: both reach the same object', async () => {
    const namespace = fakeNamespace();
    const firstIsolate = createDurableObjectPushReplayStore(namespace, 'push-jti:acme');
    const secondIsolate = createDurableObjectPushReplayStore(namespace, 'push-jti:acme');

    const first = await firstIsolate.claim('jti-hash', 60_000);
    const replayed = await secondIsolate.claim('jti-hash', 60_000);

    expect([first, replayed]).toEqual([true, false]);
    expect(namespace.storageOf('push-jti:acme')?.entries.has('jti-hash')).toBe(true);
  });

  it('keeps the keys of each name apart', async () => {
    const namespace = fakeNamespace();

    await createDurableObjectPushReplayStore(namespace, 'push-jti:acme').claim('jti-hash', 60_000);

    await expect(
      createDurableObjectPushReplayStore(namespace, 'push-jti:globex').claim('jti-hash', 60_000),
    ).resolves.toBe(true);
  });

  it.each([
    ['an error status', () => Response.json({ error: 'internal' }, { status: 500 })],
    ['an answer without "claimed"', () => Response.json({ ok: true })],
    ['an answer that is not JSON', () => new Response('<html>', { status: 200 })],
  ])('throws, so the push is refused, when the object answers %s', async (_label, answer) => {
    const namespace = { idFromName: () => 'id', get: () => ({ fetch: async () => answer() }) };

    await expect(
      createDurableObjectPushReplayStore(namespace, 'push-jti:acme').claim('jti-hash', 1_000),
    ).rejects.toThrow(/^the push replay Durable Object answered \d+$/);
  });

  it('throws when the object cannot be reached', async () => {
    const namespace = {
      idFromName: () => 'id',
      get: () => ({ fetch: async () => Promise.reject(new Error('Durable Object reset')) }),
    };

    await expect(
      createDurableObjectPushReplayStore(namespace, 'push-jti:acme').claim('jti-hash', 1_000),
    ).rejects.toThrow('Durable Object reset');
  });
});

describe('resolvePushReplayStore', () => {
  it(`uses the Durable Object bound as ${DEFAULT_PUSH_REPLAY_BINDING} by default, or under the binding named`, async () => {
    const defaultNamespace = fakeNamespace();
    const namedNamespace = fakeNamespace();
    const env = { [DEFAULT_PUSH_REPLAY_BINDING]: defaultNamespace, REPLAY: namedNamespace };

    await resolvePushReplayStore(undefined, env, 'push-jti:acme').claim('by-default', 1_000);
    await resolvePushReplayStore({ binding: 'REPLAY' }, env, 'push-jti:acme').claim('by-name', 1_000);

    expect([...(defaultNamespace.storageOf('push-jti:acme')?.entries.keys() ?? [])]).toEqual(['by-default']);
    expect([...(namedNamespace.storageOf('push-jti:acme')?.entries.keys() ?? [])]).toEqual(['by-name']);
  });

  it.each([
    ['no env', undefined],
    ['no binding', {}],
    ['a binding that is not a Durable Object namespace', { [DEFAULT_PUSH_REPLAY_BINDING]: { get: () => undefined } }],
  ])('returns a store that refuses every claim when there is %s', async (_label, env) => {
    const store = resolvePushReplayStore({}, env, 'push-jti:acme');

    await expect(store.claim('jti-hash', 1_000)).rejects.toThrow(
      `the Durable Object binding "${DEFAULT_PUSH_REPLAY_BINDING}" is not bound: export mcp.PushReplayDurableObject and bind it in wrangler.toml`,
    );
  });

  it('uses the store a function of env returns, and refuses every claim when it returns none', async () => {
    const custom = { claim: jest.fn(async () => true) };
    const env = { CUSTOM: true };

    const fromFunction = resolvePushReplayStore((received) => (received === env ? custom : undefined), env, 'name');
    const fromNothing = resolvePushReplayStore(() => undefined, env, 'name');

    expect(fromFunction).toBe(custom);
    await expect(fromNothing.claim('jti-hash', 1_000)).rejects.toThrow(
      'the managed.pushReplay function returned no store',
    );
  });
});
