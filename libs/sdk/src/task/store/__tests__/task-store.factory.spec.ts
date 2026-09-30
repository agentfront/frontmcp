import {
  createMemoryTaskStore,
  createTaskStore,
  resolvesToVercelKvTaskBackend,
  TaskStoreNotSupportedError,
} from '../task-store.factory';

describe('task-store.factory', () => {
  it('createMemoryTaskStore returns a usable memory-backed store', async () => {
    const { store, type, storage } = createMemoryTaskStore({ keyPrefix: 'test:mem:' });
    expect(type).toBe('memory');
    await storage.connect();
    const now = Date.now();
    await store.create({
      taskId: 'fact-1',
      sessionId: 's',
      status: 'working',
      createdAt: new Date(now).toISOString(),
      lastUpdatedAt: new Date(now).toISOString(),
      ttlMs: 60_000,
      expiresAt: now + 60_000,
      request: { method: 'tools/call', params: {} },
    });
    const read = await store.get('fact-1', 's');
    expect(read?.taskId).toBe('fact-1');
    await store.destroy?.();
    await storage.disconnect();
  });

  it('createTaskStore auto-detects memory in the default environment', async () => {
    const { type } = await createTaskStore({ keyPrefix: 'test:auto:' });
    expect(type).toBe('memory');
  });

  it('createTaskStore throws for Edge runtime with memory-only config', async () => {
    await expect(createTaskStore({ isEdgeRuntime: true })).rejects.toBeInstanceOf(TaskStoreNotSupportedError);
  });
  describe('Vercel KV detection (#646)', () => {
    const original = process.env['KV_REST_API_URL'];
    afterEach(() => {
      if (original === undefined) delete process.env['KV_REST_API_URL'];
      else process.env['KV_REST_API_URL'] = original;
    });

    it('rejects an explicit vercel-kv provider', async () => {
      await expect(createTaskStore({ redis: { provider: 'vercel-kv' } })).rejects.toBeInstanceOf(
        TaskStoreNotSupportedError,
      );
    });

    it('rejects the ambient KV_REST_API_URL when no backend is configured', async () => {
      process.env['KV_REST_API_URL'] = 'https://kv.example.invalid';
      await expect(createTaskStore({})).rejects.toBeInstanceOf(TaskStoreNotSupportedError);
    });

    it.each([{}, { type: 'auto' as const }])(
      'rejects the ambient KV_REST_API_URL when storage is %j (auto-detection would pick Vercel KV)',
      async (storage) => {
        process.env['KV_REST_API_URL'] = 'https://kv.example.invalid';
        await expect(createTaskStore({ storage })).rejects.toBeInstanceOf(TaskStoreNotSupportedError);
        expect(resolvesToVercelKvTaskBackend(undefined, storage)).toBe(true);
      },
    );

    it('ignores the ambient KV_REST_API_URL when a backend is explicitly configured', async () => {
      process.env['KV_REST_API_URL'] = 'https://kv.example.invalid';
      const { type } = await createTaskStore({ storage: { type: 'memory' } });
      expect(type).toBe('memory');
    });

    it('resolvesToVercelKvTaskBackend reports explicit config before the environment', () => {
      process.env['KV_REST_API_URL'] = 'https://kv.example.invalid';
      expect(resolvesToVercelKvTaskBackend()).toBe(true);
      expect(resolvesToVercelKvTaskBackend({ provider: 'vercel-kv' })).toBe(true);
      expect(resolvesToVercelKvTaskBackend({ provider: 'redis', host: 'localhost' })).toBe(false);
      expect(resolvesToVercelKvTaskBackend(undefined, { type: 'memory' })).toBe(false);
    });
  });
});
