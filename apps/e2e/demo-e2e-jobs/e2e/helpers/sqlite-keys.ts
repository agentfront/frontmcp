import { createStorage } from '@frontmcp/utils';

/** The keys a server wrote to the key-value table of its SQLite file. */
export async function sqliteKeys(path: string): Promise<string[]> {
  const storage = await createStorage({ type: 'sqlite', sqlite: { path, ttlCleanupIntervalMs: 0 } });
  try {
    return await storage.keys('*');
  } finally {
    await storage.disconnect();
  }
}
