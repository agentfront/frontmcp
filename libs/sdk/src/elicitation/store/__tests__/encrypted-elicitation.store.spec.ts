/**
 * Encrypted Elicitation Store Tests
 *
 * Tests for the encrypted wrapper around ElicitationStore.
 */

import { EncryptedElicitationStore } from '../encrypted-elicitation.store';
import { StorageElicitationStore } from '../storage-elicitation.store';
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';
import type { PendingElicitRecord } from '../elicitation.store';
import type { PendingElicitFallback, ElicitResult, FallbackExecutionResult } from '../../elicitation.types';

describe('EncryptedElicitationStore', () => {
  const testSecret = 'test-server-secret-for-encryption';
  const testSessionId1 = 'session-abc-123';
  const testSessionId2 = 'session-def-456';

  let storage: RootStorage;
  let baseStore: StorageElicitationStore;
  let encryptedStore: EncryptedElicitationStore;

  beforeEach(async () => {
    storage = createMemoryStorage({ prefix: 'test:elicit:' });
    await storage.connect();
    baseStore = new StorageElicitationStore(storage);
    encryptedStore = new EncryptedElicitationStore(baseStore, { secret: testSecret });
  });

  afterEach(async () => {
    await encryptedStore.destroy();
    await storage.disconnect();
  });

  describe('setPending / getPending', () => {
    it('should store and retrieve pending record', async () => {
      const record: PendingElicitRecord = {
        elicitId: 'elicit-123',
        sessionId: testSessionId1,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        message: 'Test message',
        mode: 'form',
      };

      await encryptedStore.setPending(record);
      const retrieved = await encryptedStore.getPending(testSessionId1);

      expect(retrieved).toEqual(record);
    });

    it('should encrypt data in storage', async () => {
      const record: PendingElicitRecord = {
        elicitId: 'elicit-123',
        sessionId: testSessionId1,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        message: 'Secret message',
        mode: 'form',
      };

      await encryptedStore.setPending(record);

      // Read directly from base store - should have encrypted blob
      const rawRecord = await baseStore.getPending(testSessionId1);
      expect(rawRecord).toBeTruthy();

      // The raw record should have __encrypted field
      const rawWithEncrypted = rawRecord as unknown as { __encrypted?: unknown };
      expect(rawWithEncrypted.__encrypted).toBeTruthy();

      // The message should still be present in the raw record (not encrypted in the outer layer)
      // but the actual secure data is in __encrypted
      expect(rawRecord?.message).toBe(record.message);
    });

    it('should not decrypt with wrong session', async () => {
      const record: PendingElicitRecord = {
        elicitId: 'elicit-123',
        sessionId: testSessionId1,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        message: 'Test message',
        mode: 'form',
      };

      await encryptedStore.setPending(record);

      // Try to get with different session - should fail to decrypt
      const retrieved = await encryptedStore.getPending(testSessionId2);
      expect(retrieved).toBeNull();
    });
  });

  describe('setPendingFallback / getPendingFallback', () => {
    it('should store and retrieve pending fallback', async () => {
      const record: PendingElicitFallback = {
        elicitId: 'elicit-fallback-123',
        sessionId: testSessionId1,
        toolName: 'testTool',
        toolInput: { param: 'value' },
        elicitMessage: 'Please confirm',
        elicitSchema: { type: 'object' },
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
      };

      await encryptedStore.setPendingFallback(record);
      const retrieved = await encryptedStore.getPendingFallback(record.elicitId, testSessionId1);

      expect(retrieved).toEqual(record);
    });

    it('should use sessionId from stored record if not provided', async () => {
      const record: PendingElicitFallback = {
        elicitId: 'elicit-fallback-123',
        sessionId: testSessionId1,
        toolName: 'testTool',
        toolInput: { param: 'value' },
        elicitMessage: 'Please confirm',
        elicitSchema: { type: 'object' },
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
      };

      await encryptedStore.setPendingFallback(record);

      // Get without passing sessionId - should still work because sessionId is preserved
      const retrieved = await encryptedStore.getPendingFallback(record.elicitId);
      expect(retrieved).toEqual(record);
    });
  });

  describe('setResolvedResult / getResolvedResult', () => {
    it('should store and retrieve resolved result', async () => {
      const elicitId = 'elicit-resolved-123';
      const result: ElicitResult<unknown> = {
        status: 'accept',
        content: { confirmed: true },
      };

      await encryptedStore.setResolvedResult(elicitId, result, testSessionId1);
      const retrieved = await encryptedStore.getResolvedResult(elicitId, testSessionId1);

      expect(retrieved).toBeTruthy();
      expect(retrieved?.elicitId).toBe(elicitId);
      expect(retrieved?.result).toEqual(result);
    });

    it('should not decrypt with wrong session', async () => {
      const elicitId = 'elicit-resolved-123';
      const result: ElicitResult<unknown> = {
        status: 'accept',
        content: { secret: 'data' },
      };

      await encryptedStore.setResolvedResult(elicitId, result, testSessionId1);
      const retrieved = await encryptedStore.getResolvedResult(elicitId, testSessionId2);

      expect(retrieved).toBeNull();
    });
  });

  describe('publishResult / subscribeResult', () => {
    it('should publish and receive encrypted result', async () => {
      const elicitId = 'elicit-pubsub-123';
      const expectedResult: ElicitResult<{ data: string }> = {
        status: 'accept',
        content: { data: 'test-value' },
      };

      let receivedResult: ElicitResult<unknown> | null = null;

      // Subscribe first
      const unsubscribe = await encryptedStore.subscribeResult(
        elicitId,
        (result) => {
          receivedResult = result;
        },
        testSessionId1,
      );

      // Publish result
      await encryptedStore.publishResult(elicitId, testSessionId1, expectedResult);

      // Wait a bit for pub/sub
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check received
      expect(receivedResult).toEqual(expectedResult);

      await unsubscribe();
    });
  });

  describe('cross-session isolation', () => {
    it('should isolate pending records between sessions', async () => {
      const record1: PendingElicitRecord = {
        elicitId: 'elicit-1',
        sessionId: testSessionId1,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        message: 'Session 1 message',
        mode: 'form',
      };

      const record2: PendingElicitRecord = {
        elicitId: 'elicit-2',
        sessionId: testSessionId2,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        message: 'Session 2 message',
        mode: 'form',
      };

      await encryptedStore.setPending(record1);
      await encryptedStore.setPending(record2);

      // Each session can only access its own record
      const retrieved1 = await encryptedStore.getPending(testSessionId1);
      const retrieved2 = await encryptedStore.getPending(testSessionId2);

      expect(retrieved1).toEqual(record1);
      expect(retrieved2).toEqual(record2);

      // Cross-session access fails (trying to decrypt with wrong key)
      // Note: This test is implicit because getPending uses the sessionId for both lookup and decryption
    });

    it('should isolate resolved results between sessions', async () => {
      const elicitId1 = 'elicit-result-1';
      const elicitId2 = 'elicit-result-2';

      const result1: ElicitResult<unknown> = { status: 'accept', content: { session: 1 } };
      const result2: ElicitResult<unknown> = { status: 'accept', content: { session: 2 } };

      await encryptedStore.setResolvedResult(elicitId1, result1, testSessionId1);
      await encryptedStore.setResolvedResult(elicitId2, result2, testSessionId2);

      // Each session can only access its own result
      const retrieved1 = await encryptedStore.getResolvedResult(elicitId1, testSessionId1);
      const retrieved2 = await encryptedStore.getResolvedResult(elicitId2, testSessionId2);

      expect(retrieved1?.result).toEqual(result1);
      expect(retrieved2?.result).toEqual(result2);

      // Cross-session access fails
      const cross1 = await encryptedStore.getResolvedResult(elicitId1, testSessionId2);
      const cross2 = await encryptedStore.getResolvedResult(elicitId2, testSessionId1);

      expect(cross1).toBeNull();
      expect(cross2).toBeNull();
    });
  });

  describe('unencrypted data handling', () => {
    it('should return null for unencrypted pending records', async () => {
      // Write unencrypted record directly to base store
      const record: PendingElicitRecord = {
        elicitId: 'elicit-unencrypted',
        sessionId: testSessionId1,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        message: 'Unencrypted message',
        mode: 'form',
      };

      await baseStore.setPending(record);

      // Read through encrypted store - should return null (no migration)
      const retrieved = await encryptedStore.getPending(testSessionId1);
      expect(retrieved).toBeNull();
    });

    it('should return null for unencrypted fallback records', async () => {
      const record: PendingElicitFallback = {
        elicitId: 'elicit-unencrypted-fallback',
        sessionId: testSessionId1,
        toolName: 'unencryptedTool',
        toolInput: {},
        elicitMessage: 'Unencrypted message',
        elicitSchema: {},
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
      };

      await baseStore.setPendingFallback(record);

      // Read through encrypted store - should return null (no migration)
      const retrieved = await encryptedStore.getPendingFallback(record.elicitId, testSessionId1);
      expect(retrieved).toBeNull();
    });
  });

  describe('publishFallbackResult / subscribeFallbackResult', () => {
    it('should publish and receive encrypted fallback result', async () => {
      const elicitId = 'elicit-fallback-pubsub-123';
      const expectedResult: FallbackExecutionResult = {
        success: true,
        result: {
          content: [{ type: 'text', text: 'Tool executed successfully' }],
        },
      };

      let receivedResult: FallbackExecutionResult | null = null;

      // Subscribe first
      const unsubscribe = await encryptedStore.subscribeFallbackResult(
        elicitId,
        (result) => {
          receivedResult = result;
        },
        testSessionId1,
      );

      // Publish result
      await encryptedStore.publishFallbackResult(elicitId, testSessionId1, expectedResult);

      // Wait a bit for pub/sub
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check received
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

      const unsubscribe = await encryptedStore.subscribeFallbackResult(
        elicitId,
        (result) => {
          receivedResult = result;
        },
        testSessionId1,
      );

      await encryptedStore.publishFallbackResult(elicitId, testSessionId1, expectedResult);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedResult).toEqual(expectedResult);

      await unsubscribe();
    });

    it('should handle multiple subscribers to same elicitId', async () => {
      const elicitId = 'elicit-fallback-multi-123';
      const expectedResult: FallbackExecutionResult = {
        success: true,
        result: { content: [] },
      };

      let receivedResult1: FallbackExecutionResult | null = null;
      let receivedResult2: FallbackExecutionResult | null = null;

      const unsubscribe1 = await encryptedStore.subscribeFallbackResult(
        elicitId,
        (result) => {
          receivedResult1 = result;
        },
        testSessionId1,
      );

      const unsubscribe2 = await encryptedStore.subscribeFallbackResult(
        elicitId,
        (result) => {
          receivedResult2 = result;
        },
        testSessionId1,
      );

      await encryptedStore.publishFallbackResult(elicitId, testSessionId1, expectedResult);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedResult1).toEqual(expectedResult);
      expect(receivedResult2).toEqual(expectedResult);

      await unsubscribe1();
      await unsubscribe2();
    });
  });

  describe('destroy', () => {
    it('should clean up underlying store', async () => {
      // Create a spy on the base store destroy method
      const destroySpy = jest.spyOn(baseStore, 'destroy');

      await encryptedStore.destroy();

      expect(destroySpy).toHaveBeenCalled();
    });
  });
});
