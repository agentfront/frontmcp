/**
 * DcrClientRegistry with a token storage (#1478): a client registered through DCR is kept there, so the next
 * process on the same storage (a restart, another instance) knows it.
 */
import { MemoryStorageAdapter } from '@frontmcp/utils';

import { DcrClientRegistry, type RegisteredClient } from '../dcr-client.registry';

const REDIRECT = 'http://127.0.0.1:9876/cb';

function dynamicClient(id: string, opts: Partial<RegisteredClient> = {}): RegisteredClient {
  return {
    client_id: id,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: [REDIRECT],
    client_name: 'Connector',
    scope: 'read',
    created_at: 1700000000,
    dev: true,
    ...opts,
  };
}

async function memoryStorage(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await storage.connect();
  return storage;
}

/** A registry on `storage`, as a process starting on it builds one. */
function registryOn(storage: MemoryStorageAdapter, config: ConstructorParameters<typeof DcrClientRegistry>[0] = {}) {
  const registry = new DcrClientRegistry(config);
  registry.useStore(storage);
  return registry;
}

async function registerAndPersist(registry: DcrClientRegistry, client: RegisteredClient): Promise<void> {
  expect(registry.register(client)).toBe(true);
  await registry.persist(client);
}

describe('DcrClientRegistry — clients kept in the token storage', () => {
  it('lets the next registry on the same storage load a client registered by the first', async () => {
    const storage = await memoryStorage();
    await registerAndPersist(registryOn(storage), dynamicClient('c1'));

    const restarted = registryOn(storage);
    expect(restarted.get('c1')).toBeUndefined();

    expect(await restarted.load('c1')).toEqual(dynamicClient('c1'));
    expect(restarted.get('c1')).toEqual(dynamicClient('c1'));
    expect(restarted.has('c1')).toBe(true);
  });

  it('finds nothing for a client no registry registered', async () => {
    const registry = registryOn(await memoryStorage());
    expect(await registry.load('never-registered')).toBeUndefined();
    expect(registry.has('never-registered')).toBe(false);
  });

  it('keeps clients in memory only without a store, as before', async () => {
    const storage = await memoryStorage();
    const first = new DcrClientRegistry();
    await registerAndPersist(first, dynamicClient('c1'));

    expect(await storage.keys()).toEqual([]);
    expect(await new DcrClientRegistry().load('c1')).toBeUndefined();
    expect(await first.load('c1')).toEqual(dynamicClient('c1'));
  });

  it('stores a confidential client with a digest of its secret, which still verifies it after a restart', async () => {
    const storage = await memoryStorage();
    const secret = 'dcr-minted-secret-value';
    await registerAndPersist(
      registryOn(storage),
      dynamicClient('conf', { token_endpoint_auth_method: 'client_secret_post', client_secret: secret }),
    );

    const raw = await storage.get('oauth:client:conf');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(secret);
    expect(JSON.parse(raw ?? '{}')).not.toHaveProperty('client_secret');

    const restarted = registryOn(storage);
    const loaded = await restarted.load('conf');
    expect(loaded?.client_secret).toBeUndefined();
    expect(restarted.verifyClientSecret('conf', secret)).toBe('ok');
    expect(restarted.verifyClientSecret('conf', 'wrong-secret')).toBe('invalid');
    expect(restarted.verifyClientSecret('conf', undefined)).toBe('invalid');
  });

  it('keeps a client for a refresh token lifetime, and for another one after each token grant', async () => {
    const storage = await memoryStorage();
    const registry = new DcrClientRegistry();
    registry.useStore(storage, { ttlSeconds: 600 });
    await registerAndPersist(registry, dynamicClient('c1'));
    expect(await storage.ttl('oauth:client:c1')).toBeGreaterThan(590);

    await storage.expire('oauth:client:c1', 5);
    await registry.touch('c1');
    expect(await storage.ttl('oauth:client:c1')).toBeGreaterThan(590);
  });

  it('keeps a client for another lifetime after a token grant, even when a load for another client dropped it', async () => {
    const storage = await memoryStorage();
    const first = registryOn(storage);
    for (const id of ['a', 'b']) await registerAndPersist(first, dynamicClient(id));

    const restarted = new DcrClientRegistry({ maxDynamicClients: 1 });
    restarted.useStore(storage, { ttlSeconds: 600 });
    await restarted.load('a');
    await storage.expire('oauth:client:a', 5);
    // Another grant's load, while this grant runs, drops `a` from memory.
    await restarted.load('b');
    expect(restarted.has('a')).toBe(false);

    await restarted.touch('a');

    expect(await storage.ttl('oauth:client:a')).toBeGreaterThan(590);
  });

  it('defaults the lifetime to a refresh token lifetime (30 days)', async () => {
    const storage = await memoryStorage();
    await registerAndPersist(registryOn(storage), dynamicClient('c1'));
    expect(await storage.ttl('oauth:client:c1')).toBeGreaterThan(30 * 24 * 3600 - 10);
  });

  it('writes a client again on a token grant when the store no longer has it', async () => {
    const storage = await memoryStorage();
    const registry = registryOn(storage);
    expect(registry.register(dynamicClient('c1'))).toBe(true);

    await registry.touch('c1');

    expect(await registryOn(storage).load('c1')).toEqual(dynamicClient('c1'));
  });

  it('never writes a pre-registered client to the store', async () => {
    const storage = await memoryStorage();
    const registry = registryOn(storage, { clients: [{ clientId: 'seeded', redirectUris: [REDIRECT] }] });

    const seeded = registry.get('seeded');
    if (seeded) await registry.persist(seeded);
    await registry.touch('seeded');

    expect(await storage.keys()).toEqual([]);
    expect(registry.get('seeded')?.preRegistered).toBe(true);
  });

  it('finds no client when the store cannot be read, and says so', async () => {
    const storage = await memoryStorage();
    await registerAndPersist(registryOn(storage), dynamicClient('c1'));
    const onError = jest.fn();
    const restarted = new DcrClientRegistry();
    restarted.useStore(storage, { onError });
    jest.spyOn(storage, 'get').mockRejectedValueOnce(new Error('store down'));

    expect(await restarted.load('c1')).toBeUndefined();
    expect(onError).toHaveBeenCalledWith('read', expect.objectContaining({ message: 'store down' }));
    expect(await restarted.load('c1')).toEqual(dynamicClient('c1'));
  });

  it('keeps a client in memory when the store cannot be written, and says so', async () => {
    const storage = await memoryStorage();
    const onError = jest.fn();
    const registry = new DcrClientRegistry();
    registry.useStore(storage, { onError });
    jest.spyOn(storage, 'set').mockRejectedValueOnce(new Error('store down'));

    await registerAndPersist(registry, dynamicClient('c1'));

    expect(onError).toHaveBeenCalledWith('write', expect.objectContaining({ message: 'store down' }));
    expect(registry.get('c1')).toEqual(dynamicClient('c1'));
  });

  it('does not count clients read from the store toward the dynamic-client cap', async () => {
    const storage = await memoryStorage();
    const first = registryOn(storage, { maxDynamicClients: 2 });
    await registerAndPersist(first, dynamicClient('a'));
    await registerAndPersist(first, dynamicClient('b'));

    const restarted = registryOn(storage, { maxDynamicClients: 2 });
    await restarted.load('a');
    await restarted.load('b');

    expect(restarted.register(dynamicClient('c'))).toBe(true);
    expect(restarted.register(dynamicClient('d'))).toBe(true);
    expect(restarted.register(dynamicClient('e'))).toBe(false);
  });

  it('holds at most the cap of clients read from the store, and reads a dropped one again', async () => {
    const storage = await memoryStorage();
    const first = registryOn(storage);
    for (const id of ['a', 'b', 'c']) await registerAndPersist(first, dynamicClient(id));

    const restarted = registryOn(storage, { maxDynamicClients: 2 });
    for (const id of ['a', 'b', 'c']) await restarted.load(id);

    expect(['a', 'b', 'c'].filter((id) => restarted.has(id))).toEqual(['b', 'c']);
    expect(await restarted.load('a')).toEqual(dynamicClient('a'));
  });
});
