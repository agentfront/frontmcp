/**
 * Storage key format written by a GuardManager built through the factory.
 *
 * The default `keyPrefix` ends in `:`, and `storage.namespace()` appends its own
 * separator, so counters used to land under `mcp:guard::<entity>:…`. These specs
 * run the real memory storage and read back the keys a rate-limit check writes.
 */
import type { RootStorage } from '@frontmcp/utils';

import { createGuardManager } from '../guard.factory';
import type { GuardConfig } from '../types';

let mockCreatedStorage: RootStorage | undefined;

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return {
    ...actual,
    createMemoryStorage: (...args: Parameters<typeof actual.createMemoryStorage>) => {
      mockCreatedStorage = actual.createMemoryStorage(...args);
      return mockCreatedStorage;
    },
  };
});

async function keysWrittenFor(config: Partial<GuardConfig>): Promise<string[]> {
  const manager = await createGuardManager({ config: { enabled: true, ...config } });
  await manager.checkRateLimit('export_tickets', { maxRequests: 5, partitionBy: 'global' }, undefined);
  if (!mockCreatedStorage) throw new Error('createMemoryStorage was not called');
  return mockCreatedStorage.keys('*');
}

describe('createGuardManager — storage key format', () => {
  beforeEach(() => {
    mockCreatedStorage = undefined;
  });

  it('writes the default prefix with a single separator', async () => {
    const keys = await keysWrittenFor({});

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain('::');
      expect(key.startsWith('mcp:guard:export_tickets:')).toBe(true);
    }
  });

  it('writes a custom prefix that ends in a colon with a single separator', async () => {
    const keys = await keysWrittenFor({ keyPrefix: 'acme:rl:' });

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain('::');
      expect(key.startsWith('acme:rl:export_tickets:')).toBe(true);
    }
  });

  it('keeps the keys of a prefix written without a trailing colon', async () => {
    const keys = await keysWrittenFor({ keyPrefix: 'acme:rl' });

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith('acme:rl:export_tickets:')).toBe(true);
    }
  });
});
