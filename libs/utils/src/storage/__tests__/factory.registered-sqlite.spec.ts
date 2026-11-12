import { registerOptionalModule } from '../../optional-module';
import { MemoryStorageAdapter } from '../adapters/memory';
import { createStorage } from '../factory';

jest.mock('@frontmcp/storage-sqlite', () => {
  throw new Error('@frontmcp/storage-sqlite was required');
});

const SQLITE_STORAGE = '@frontmcp/storage-sqlite';
const REGISTRY = Symbol.for('frontmcp.bundledOptionalModules');
const SQLITE = { type: 'sqlite', sqlite: { path: 'bundled.sqlite' }, fallback: 'error' } as const;

describe('createStorage() with @frontmcp/storage-sqlite registered', () => {
  afterEach(() => {
    (globalThis as unknown as Record<symbol, Map<string, unknown>>)[REGISTRY].delete(SQLITE_STORAGE);
  });

  it('builds the adapter from the registered module, without requiring the package', async () => {
    const SqliteStorageAdapter = jest.fn(() => new MemoryStorageAdapter());
    registerOptionalModule(SQLITE_STORAGE, { SqliteStorageAdapter });

    const storage = await createStorage(SQLITE);
    await storage.set('k', 'v');

    expect(SqliteStorageAdapter).toHaveBeenCalledWith({ path: 'bundled.sqlite' });
    expect(await storage.get('k')).toBe('v');
    await storage.disconnect();
  });

  it('requires the package when it is not registered', async () => {
    registerOptionalModule('@frontmcp/another-package', {});

    await expect(createStorage(SQLITE)).rejects.toThrow('@frontmcp/storage-sqlite was required');
  });
});
