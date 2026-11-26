import { createStorage, type StorageConfig } from '@frontmcp/utils';

import { ResultHandleStore, type ResultHandleRetention } from './result-handle.store';

export interface ResultHandleStoreOptions extends ResultHandleRetention {
  /** Passed to `createStorage()`: memory, Redis, Vercel KV, Upstash or SQLite. */
  storage: StorageConfig;
  /** The key prefix of folded answers. */
  namespace: string;
  ttlSeconds: number;
}

/** A connected {@link ResultHandleStore} on the storage `options.storage` describes. */
export async function createResultHandleStore(options: ResultHandleStoreOptions): Promise<ResultHandleStore> {
  const storage = await createStorage(options.storage);
  const { slidingTtl, maxStoredBytes } = options;
  return new ResultHandleStore(storage.namespace(options.namespace), options.ttlSeconds, {
    slidingTtl,
    maxStoredBytes,
  });
}
