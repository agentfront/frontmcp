/**
 * Storage Elicitation Store Tests
 *
 * Tests for the storage-based elicitation store.
 */

import { StorageElicitationStore } from '../storage-elicitation.store';
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';
import type { PendingElicitRecord } from '../elicitation.store';
import type { PendingElicitFallback, ElicitResult, FallbackExecutionResult } from '../../elicitation.types';

describe('StorageElicitationStore', () => {
  const testSessionId = 'session-abc-123';

  let storage: RootStorage;
  let store: StorageElicitationStore;

  beforeEach(async () => {
    storage = createMemoryStorage({ prefix: 'test:elicit:' });
    await storage.connect();
    store = new StorageElicitationStore(storage);
  });

  afterEach(async () => {
    await store.destroy();
    await storage.disconnect();
  });

  describe('pending elicitation', () => {
    it('should store and retrieve pending record', async () => {
      const record: PendingElicitRecord = {
        elicitId: 'elicit-123',
        sessionId: testSessionId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        message: 'Test message',
        mode: 'form',
      };

      await store.setPending(record);
      const retrieved = await store.getPending(testSessionId);

      expect(retrieved).toEqual(record);
    });

    it('should return null for non-existent record', async () => {
      const retrieved = await store.getPending('non-existent-session');
      expect(retrieved).toBeNull();
    });

    it('should delete pending record', async () => {
      const record: PendingElicitRecord = {
        elicitId: 'elicit-delete-123',
        sessionId: testSessionId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        message: 'Test message',
        mode: 'form',
      };

      await store.setPending(record);
      await store.deletePending(testSessionId);
      const retrieved = await store.getPending(testSessionId);

      expect(retrieved).toBeNull();
    });

    it('should not store expired record', async () => {
      const record: PendingElicitRecord = {
        elicitId: 'elicit-expired-123',
        sessionId: testSessionId,
        createdAt: Date.now() - 1000,
        expiresAt: Date.now() - 500, // Already expired
        message: 'Expired message',
        mode: 'form',
      };

      await store.setPending(record);
      const retrieved = await store.getPending(testSessionId);

      expect(retrieved).toBeNull();
    });
  });

  describe('publishResult / subscribeResult', () => {
    it('should publish and receive result', async () => {
      const elicitId = 'elicit-pubsub-123';
      const expectedResult: ElicitResult<{ data: string }> = {
        status: 'accept',
        content: { data: 'test-value' },
      };

      let receivedResult: ElicitResult<unknown> | null = null;

      const unsubscribe = await store.subscribeResult(
        elicitId,
        (result) => {
          receivedResult = result;
        },
        testSessionId,
      );

      await store.publishResult(elicitId, testSessionId, expectedResult);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedResult).toEqual(expectedResult);

      await unsubscribe();
    });

    it('should handle cancel status', async () => {
      const elicitId = 'elicit-cancel-123';
      const expectedResult: ElicitResult<unknown> = {
        status: 'cancel',
      };

      let receivedResult: ElicitResult<unknown> | null = null;

      const unsubscribe = await store.subscribeResult(
        elicitId,
        (result) => {
          receivedResult = result;
        },
        testSessionId,
      );

      await store.publishResult(elicitId, testSessionId, expectedResult);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedResult).toEqual(expectedResult);

      await unsubscribe();
    });
  });

  describe('pending fallback', () => {
    it('should store and retrieve pending fallback', async () => {
      const record: PendingElicitFallback = {
        elicitId: 'elicit-fallback-123',
        sessionId: testSessionId,
        toolName: 'testTool',
        toolInput: { param: 'value' },
        elicitMessage: 'Please confirm',
        elicitSchema: { type: 'object' },
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
      };

      await store.setPendingFallback(record);
      const retrieved = await store.getPendingFallback(record.elicitId);

      expect(retrieved).toEqual(record);
    });

    it('should delete pending fallback', async () => {
      const record: PendingElicitFallback = {
        elicitId: 'elicit-fallback-delete-123',
        sessionId: testSessionId,
        toolName: 'testTool',
        toolInput: {},
        elicitMessage: 'Please confirm',
        elicitSchema: {},
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
      };

      await store.setPendingFallback(record);
      await store.deletePendingFallback(record.elicitId);
      const retrieved = await store.getPendingFallback(record.elicitId);

      expect(retrieved).toBeNull();
    });
  });

  describe('resolved result', () => {
    it('should store and retrieve resolved result', async () => {
      const elicitId = 'elicit-resolved-123';
      const result: ElicitResult<unknown> = {
        status: 'accept',
        content: { confirmed: true },
      };

      await store.setResolvedResult(elicitId, result, testSessionId);
      const retrieved = await store.getResolvedResult(elicitId);

      expect(retrieved).toBeTruthy();
      expect(retrieved?.elicitId).toBe(elicitId);
      expect(retrieved?.result).toEqual(result);
    });

    it('should delete resolved result', async () => {
      const elicitId = 'elicit-resolved-delete-123';
      const result: ElicitResult<unknown> = {
        status: 'accept',
        content: {},
      };

      await store.setResolvedResult(elicitId, result);
      await store.deleteResolvedResult(elicitId);
      const retrieved = await store.getResolvedResult(elicitId);

      expect(retrieved).toBeNull();
    });
  });

  describe('publishFallbackResult / subscribeFallbackResult', () => {
    it('should publish and receive fallback result', async () => {
      const elicitId = 'elicit-fallback-pubsub-123';
      const expectedResult: FallbackExecutionResult = {
        success: true,
        result: {
          content: [{ type: 'text', text: 'Tool executed successfully' }],
        },
      };

      let receivedResult: FallbackExecutionResult | null = null;

      const unsubscribe = await store.subscribeFallbackResult(
        elicitId,
        (result) => {
          receivedResult = result;
        },
        testSessionId,
      );

      await store.publishFallbackResult(elicitId, testSessionId, expectedResult);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedResult).toEqual(expectedResult);

      await unsubscribe();
    });

    it('should publish and receive error fallback result', async () => {
      const elicitId = 'elicit-fallback-error-123';
      const expectedResult: FallbackExecutionResult = {
        success: false,
        error: 'Tool execution failed',
      };

      let receivedResult: FallbackExecutionResult | null = null;

      const unsubscribe = await store.subscribeFallbackResult(
        elicitId,
        (result) => {
          receivedResult = result;
        },
        testSessionId,
      );

      await store.publishFallbackResult(elicitId, testSessionId, expectedResult);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedResult).toEqual(expectedResult);

      await unsubscribe();
    });

    it('should handle multiple subscribers', async () => {
      const elicitId = 'elicit-fallback-multi-123';
      const expectedResult: FallbackExecutionResult = {
        success: true,
        result: { content: [] },
      };

      let receivedResult1: FallbackExecutionResult | null = null;
      let receivedResult2: FallbackExecutionResult | null = null;

      const unsubscribe1 = await store.subscribeFallbackResult(
        elicitId,
        (result) => {
          receivedResult1 = result;
        },
        testSessionId,
      );

      const unsubscribe2 = await store.subscribeFallbackResult(
        elicitId,
        (result) => {
          receivedResult2 = result;
        },
        testSessionId,
      );

      await store.publishFallbackResult(elicitId, testSessionId, expectedResult);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedResult1).toEqual(expectedResult);
      expect(receivedResult2).toEqual(expectedResult);

      await unsubscribe1();
      await unsubscribe2();
    });

    it('should unsubscribe correctly', async () => {
      const elicitId = 'elicit-fallback-unsub-123';
      const result1: FallbackExecutionResult = { success: true, result: { data: 1 } };
      const result2: FallbackExecutionResult = { success: true, result: { data: 2 } };

      let receivedCount = 0;

      const unsubscribe = await store.subscribeFallbackResult(
        elicitId,
        () => {
          receivedCount++;
        },
        testSessionId,
      );

      // First publish should be received
      await store.publishFallbackResult(elicitId, testSessionId, result1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(receivedCount).toBe(1);

      // Unsubscribe
      await unsubscribe();

      // Second publish should NOT be received
      await store.publishFallbackResult(elicitId, testSessionId, result2);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(receivedCount).toBe(1); // Still 1
    });

    it('should handle concurrent subscriptions to same channel', async () => {
      const elicitId = 'elicit-fallback-concurrent-123';
      const expectedResult: FallbackExecutionResult = {
        success: true,
        result: { content: [] },
      };

      const results: FallbackExecutionResult[] = [];

      // Subscribe multiple times in parallel
      const [unsub1, unsub2, unsub3] = await Promise.all([
        store.subscribeFallbackResult(elicitId, (r) => results.push(r), testSessionId),
        store.subscribeFallbackResult(elicitId, (r) => results.push(r), testSessionId),
        store.subscribeFallbackResult(elicitId, (r) => results.push(r), testSessionId),
      ]);

      await store.publishFallbackResult(elicitId, testSessionId, expectedResult);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(results.length).toBe(3);
      results.forEach((r) => expect(r).toEqual(expectedResult));

      await unsub1();
      await unsub2();
      await unsub3();
    });
  });

  describe('destroy', () => {
    it('should clean up all subscriptions', async () => {
      const elicitId1 = 'elicit-destroy-1';
      const elicitId2 = 'elicit-destroy-2';

      // Create some subscriptions
      const unsub1 = await store.subscribeResult(elicitId1, () => {}, testSessionId);
      const unsub2 = await store.subscribeFallbackResult(elicitId2, () => {}, testSessionId);

      // Destroy should clean up without errors
      await store.destroy();

      // Unsubscribing after destroy should not throw
      await expect(unsub1()).resolves.not.toThrow();
      await expect(unsub2()).resolves.not.toThrow();
    });
  });
});
