import { registerOptionalModule } from '@frontmcp/utils';

import { createTokenStorageAdapter } from '../token-storage.factory';

jest.mock(
  '@frontmcp/storage-sqlite',
  () => {
    throw new Error('@frontmcp/storage-sqlite was required');
  },
  { virtual: true },
);

const SQLITE_STORAGE = '@frontmcp/storage-sqlite';
const REGISTRY = Symbol.for('frontmcp.bundledOptionalModules');

describe('createTokenStorageAdapter() with @frontmcp/storage-sqlite registered', () => {
  afterEach(() => {
    (globalThis as unknown as Record<symbol, Map<string, unknown>>)[REGISTRY].delete(SQLITE_STORAGE);
  });

  it('builds the adapter from the registered module, without requiring the package', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const SqliteStorageAdapter = jest.fn(() => ({ connect }));
    registerOptionalModule(SQLITE_STORAGE, { SqliteStorageAdapter });

    const adapter = await createTokenStorageAdapter({ sqlite: { path: 'bundled.sqlite' } });

    expect(SqliteStorageAdapter).toHaveBeenCalledWith(expect.objectContaining({ path: 'bundled.sqlite' }));
    expect(adapter).toBe(SqliteStorageAdapter.mock.results[0].value);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('requires the package when it is not registered', async () => {
    registerOptionalModule('@frontmcp/another-package', {});

    await expect(createTokenStorageAdapter({ sqlite: { path: 'unbundled.sqlite' } })).rejects.toThrow(
      '@frontmcp/storage-sqlite was required',
    );
  });
});
