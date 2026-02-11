import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { SqliteElicitationStore } from '../sqlite-elicitation.store';
import type { PendingElicitRecord } from '../sqlite-elicitation.store';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-elicit-'));
  return path.join(dir, 'test.sqlite');
}

function cleanup(dbPath: string): void {
  try {
    const dir = path.dirname(dbPath);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe('SqliteElicitationStore', () => {
  let store: SqliteElicitationStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = new SqliteElicitationStore({
      path: dbPath,
      ttlCleanupIntervalMs: 0,
    });
  });

  afterEach(async () => {
    await store.destroy();
    cleanup(dbPath);
  });

  describe('pending elicitations', () => {
    const record: PendingElicitRecord = {
      elicitId: 'elicit-1',
      sessionId: 'session-1',
      createdAt: Date.now(),
      expiresAt: Date.now() + 300000,
      message: 'Confirm action?',
      mode: 'form',
    };

    it('should store and retrieve pending elicitation', async () => {
      await store.setPending(record);
      const result = await store.getPending('session-1');
      expect(result).toEqual(record);
    });

    it('should return null for non-existent pending', async () => {
      const result = await store.getPending('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete pending elicitation', async () => {
      await store.setPending(record);
      await store.deletePending('session-1');
      const result = await store.getPending('session-1');
      expect(result).toBeNull();
    });

    it('should not store records with expired TTL', async () => {
      const expiredRecord = {
        ...record,
        expiresAt: Date.now() - 1000, // Already expired
      };
      await store.setPending(expiredRecord);
      const result = await store.getPending('session-1');
      expect(result).toBeNull();
    });
  });

  describe('pub/sub via EventEmitter', () => {
    it('should publish and subscribe to results', async () => {
      const resultPromise = new Promise<unknown>((resolve) => {
        store.subscribeResult('elicit-1', (result) => {
          resolve(result);
        });
      });

      await store.publishResult('elicit-1', 'session-1', {
        status: 'accept',
        content: { confirmed: true },
      });

      const result = await resultPromise;
      expect(result).toEqual({
        status: 'accept',
        content: { confirmed: true },
      });
    });

    it('should support unsubscribe', async () => {
      let callCount = 0;
      const unsubscribe = await store.subscribeResult('elicit-2', () => {
        callCount++;
      });

      await store.publishResult('elicit-2', 'session-1', { status: 'accept' });
      expect(callCount).toBe(1);

      await unsubscribe();
      await store.publishResult('elicit-2', 'session-1', { status: 'accept' });
      expect(callCount).toBe(1); // No additional call
    });

    it('should clean up pending record on publish', async () => {
      const record: PendingElicitRecord = {
        elicitId: 'elicit-3',
        sessionId: 'session-3',
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        message: 'Test',
        mode: 'form',
      };

      await store.setPending(record);
      await store.publishResult('elicit-3', 'session-3', { status: 'accept' });

      const pending = await store.getPending('session-3');
      expect(pending).toBeNull();
    });
  });

  describe('fallback elicitation', () => {
    it('should store and retrieve fallback records', async () => {
      const fallback = { elicitId: 'fb-1', toolName: 'test-tool', args: { key: 'value' } };
      await store.setPendingFallback(fallback);

      const result = await store.getPendingFallback('fb-1');
      expect(result).toEqual(fallback);
    });

    it('should delete fallback records', async () => {
      await store.setPendingFallback({ elicitId: 'fb-2', data: 'test' });
      await store.deletePendingFallback('fb-2');

      const result = await store.getPendingFallback('fb-2');
      expect(result).toBeNull();
    });
  });

  describe('resolved results', () => {
    it('should store and retrieve resolved results', async () => {
      const result = { status: 'accept', content: { value: 42 } };
      await store.setResolvedResult('elicit-5', result);

      const retrieved = await store.getResolvedResult('elicit-5');
      expect(retrieved).toEqual(result);
    });

    it('should delete resolved results', async () => {
      await store.setResolvedResult('elicit-6', { status: 'accept' });
      await store.deleteResolvedResult('elicit-6');

      const result = await store.getResolvedResult('elicit-6');
      expect(result).toBeNull();
    });
  });

  describe('fallback pub/sub', () => {
    it('should publish and subscribe to fallback results', async () => {
      const resultPromise = new Promise<unknown>((resolve) => {
        store.subscribeFallbackResult('fb-3', (result) => {
          resolve(result);
        });
      });

      await store.publishFallbackResult('fb-3', 'session-1', { toolResult: 'success' });

      const result = await resultPromise;
      expect(result).toEqual({ toolResult: 'success' });
    });
  });

  describe('destroy', () => {
    it('should clean up resources on destroy', async () => {
      await store.destroy();
      // Store should be unusable after destroy
      // A second destroy should be safe
      // Note: the afterEach will try to destroy again, which should be safe
    });
  });
});
