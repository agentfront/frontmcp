import { createMemoryTaskStore, createTaskStore, TaskStoreNotSupportedError } from '../task-store.factory';

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
});
