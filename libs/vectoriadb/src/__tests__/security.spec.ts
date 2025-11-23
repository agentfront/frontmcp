/**
 * Security Tests for VectoriaDB
 * Comprehensive security validation and protection mechanisms
 */

import { VectoriaDB } from '../vectoria';
import { FileStorageAdapter } from '../storage/file.adapter';
import { RedisStorageAdapter } from '../storage/redis.adapter';
import * as SerializationUtils from '../storage/serialization.utils';
import { isPotentiallyVulnerableRegex, SAFE_PATTERNS } from '../regex.utils';
import { DocumentValidationError } from '../errors';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Security Tests', () => {
  describe('Path Traversal Protection', () => {
    it('should prevent directory traversal in FileStorageAdapter namespace', async () => {
      const maliciousNamespace = '../../../etc/passwd';
      const adapter = new FileStorageAdapter({
        namespace: maliciousNamespace,
        cacheDir: './.cache/security-test',
      });

      await adapter.initialize();

      // Verify the file path doesn't escape the cache directory
      const filePath = (adapter as any).filePath;
      const resolvedPath = path.resolve(filePath);
      const cacheDir = path.resolve('./.cache/security-test');

      expect(resolvedPath.startsWith(cacheDir)).toBe(true);
      expect(resolvedPath).not.toContain('..');
      expect(resolvedPath).not.toContain('etc/passwd');

      await adapter.close();
    });

    it('should sanitize namespace with path separators', async () => {
      const maliciousNamespace = 'test/../../admin';
      const adapter = new FileStorageAdapter({
        namespace: maliciousNamespace,
        cacheDir: './.cache/security-test',
      });

      await adapter.initialize();

      const filePath = (adapter as any).filePath;
      // Path separators in the actual path are OK, but the namespace part should be sanitized
      expect(filePath).not.toContain('../');
      // Check that path separators from the malicious input were sanitized
      expect(filePath).toContain('test---admin'); // each / becomes -, .. removed leaves ///

      await adapter.close();
    });

    it('should sanitize extremely malicious namespace', () => {
      // Create adapter with extremely malicious namespace - it should sanitize, not throw
      const adapter = new FileStorageAdapter({
        namespace: '../'.repeat(100),
        cacheDir: './.cache/security-test',
      });

      const filePath = (adapter as any).filePath;
      const resolvedPath = path.resolve(filePath);
      const cacheDir = path.resolve('./.cache/security-test');

      // Should still be within cache directory
      expect(resolvedPath.startsWith(cacheDir)).toBe(true);
    });
  });

  describe('Prototype Pollution Protection', () => {
    it('should prevent prototype pollution via __proto__ in JSON', () => {
      const maliciousJson = JSON.stringify({
        metadata: {
          version: '1.0.0',
          toolsHash: 'abc123',
          timestamp: Date.now(),
          modelName: 'test',
          dimensions: 384,
          documentCount: 1,
        },
        embeddings: [
          {
            id: 'test-1',
            vector: [0.1, 0.2, 0.3],
            metadata: {
              __proto__: { isAdmin: true },
              id: 'test-1',
              category: 'test',
            },
            text: 'test document',
            createdAt: new Date().toISOString(),
          },
        ],
      });

      const parsed = JSON.parse(maliciousJson);
      const sanitized = SerializationUtils.sanitizeObject(parsed) as any;

      // Verify __proto__ was blocked (check it's not an own property)
      expect(sanitized).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(sanitized.embeddings[0].metadata, '__proto__')).toBe(false);

      // Verify prototype wasn't polluted
      const testObj: any = {};
      expect(testObj.isAdmin).toBeUndefined();
    });

    it('should prevent prototype pollution via constructor in JSON', () => {
      const maliciousJson = JSON.stringify({
        metadata: {
          version: '1.0.0',
          toolsHash: 'abc123',
          timestamp: Date.now(),
          modelName: 'test',
          dimensions: 384,
          documentCount: 1,
        },
        embeddings: [
          {
            id: 'test-1',
            vector: [0.1, 0.2, 0.3],
            metadata: {
              constructor: { prototype: { isAdmin: true } },
              id: 'test-1',
              category: 'test',
            },
            text: 'test document',
            createdAt: new Date().toISOString(),
          },
        ],
      });

      const parsed = JSON.parse(maliciousJson);
      const sanitized = SerializationUtils.sanitizeObject(parsed) as any;

      // Verify constructor was blocked (check it's not an own property)
      expect(sanitized).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(sanitized.embeddings[0].metadata, 'constructor')).toBe(false);
    });

    it('should sanitize nested objects recursively', () => {
      const maliciousJson = JSON.stringify({
        metadata: {
          version: '1.0.0',
          toolsHash: 'abc123',
          timestamp: Date.now(),
          modelName: 'test',
          dimensions: 384,
          documentCount: 1,
        },
        embeddings: [
          {
            id: 'test-1',
            vector: [0.1, 0.2, 0.3],
            metadata: {
              id: 'test-1',
              nested: {
                deeper: {
                  __proto__: { polluted: true },
                  safeField: 'value',
                },
              },
            },
            text: 'test document',
            createdAt: new Date().toISOString(),
          },
        ],
      });

      const parsed = JSON.parse(maliciousJson);
      const sanitized = SerializationUtils.sanitizeObject(parsed) as any;

      expect(sanitized).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(sanitized.embeddings[0].metadata.nested.deeper, '__proto__')).toBe(
        false,
      );
      expect(sanitized.embeddings[0].metadata.nested.deeper.safeField).toBe('value');
    });
  });

  describe('Resource Limit Enforcement', () => {
    let db: VectoriaDB;

    beforeEach(async () => {
      db = new VectoriaDB({
        maxDocuments: 10,
        maxDocumentSize: 100,
        maxBatchSize: 5,
      });
      await db.initialize();
    });

    afterEach(async () => {
      await db.close();
    });

    it('should reject adding documents beyond maxDocuments limit', async () => {
      // Add up to the limit
      for (let i = 0; i < 10; i++) {
        await db.add(`doc-${i}`, `Document ${i}`, { id: `doc-${i}` });
      }

      // Try to add one more
      await expect(db.add('doc-11', 'Exceeds limit', { id: 'doc-11' })).rejects.toThrow(DocumentValidationError);
      await expect(db.add('doc-11', 'Exceeds limit', { id: 'doc-11' })).rejects.toThrow(/Document limit exceeded/);
    });

    it('should reject documents exceeding maxDocumentSize', async () => {
      const largeText = 'a'.repeat(101); // 101 characters

      await expect(db.add('large-doc', largeText, { id: 'large-doc' })).rejects.toThrow(DocumentValidationError);
      await expect(db.add('large-doc', largeText, { id: 'large-doc' })).rejects.toThrow(/exceeds maximum size/);
    });

    it('should reject batch operations exceeding maxBatchSize', async () => {
      const largeBatch = Array.from({ length: 6 }, (_, i) => ({
        id: `batch-${i}`,
        text: `Document ${i}`,
        metadata: { id: `batch-${i}` },
      }));

      await expect(db.addMany(largeBatch)).rejects.toThrow(DocumentValidationError);
      await expect(db.addMany(largeBatch)).rejects.toThrow(/Batch size exceeds maximum/);
    });

    it('should reject batch that would exceed total document limit', async () => {
      // Add 8 documents
      for (let i = 0; i < 8; i++) {
        await db.add(`doc-${i}`, `Document ${i}`, { id: `doc-${i}` });
      }

      // Try to add batch of 5 (total would be 13, exceeds limit of 10)
      const batch = Array.from({ length: 5 }, (_, i) => ({
        id: `batch-${i}`,
        text: `Document ${i}`,
        metadata: { id: `batch-${i}` },
      }));

      await expect(db.addMany(batch)).rejects.toThrow(DocumentValidationError);
      await expect(db.addMany(batch)).rejects.toThrow(/would exceed maximum document limit/);
    });

    it('should reject update with oversized text', async () => {
      await db.add('doc-1', 'Original text', { id: 'doc-1' });

      const largeText = 'b'.repeat(101);
      await expect(db.update('doc-1', { text: largeText })).rejects.toThrow(DocumentValidationError);
      await expect(db.update('doc-1', { text: largeText })).rejects.toThrow(/exceeds maximum size/);
    });

    it('should reject updateMany exceeding batch size', async () => {
      // Add initial documents
      for (let i = 0; i < 6; i++) {
        await db.add(`doc-${i}`, `Document ${i}`, { id: `doc-${i}` });
      }

      const updates = Array.from({ length: 6 }, (_, i) => ({
        id: `doc-${i}`,
        text: `Updated ${i}`,
      }));

      await expect(db.updateMany(updates)).rejects.toThrow(DocumentValidationError);
      await expect(db.updateMany(updates)).rejects.toThrow(/Batch size exceeds maximum/);
    });
  });

  describe('Cryptographic Hashing', () => {
    it('should use SHA-256 for hashing instead of weak hash', () => {
      const input = 'test-input-string';
      const hash = SerializationUtils.hash(input);

      // SHA-256 produces a hex string, our implementation takes first 16 chars
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]+$/);

      // Verify it matches SHA-256
      const expectedHash = createHash('sha256').update(input, 'utf8').digest('hex').substring(0, 16);
      expect(hash).toBe(expectedHash);
    });

    it('should produce consistent hashes', () => {
      const input = 'test-consistency';
      const hash1 = SerializationUtils.hash(input);
      const hash2 = SerializationUtils.hash(input);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = SerializationUtils.hash('input-1');
      const hash2 = SerializationUtils.hash('input-2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Redis Key Sanitization', () => {
    // Helper function to create a mock Redis client
    const createMockRedisClient = () => ({
      get: async () => null,
      set: async () => 'OK',
      setex: async () => 'OK',
      del: async () => 1,
      ping: async () => 'PONG',
      quit: async () => {
        /* no-op for test mock */
      },
    });

    it('should sanitize namespace with newline characters', () => {
      const mockClient = createMockRedisClient();
      const maliciousNamespace = 'test\nFLUSHDB\n';
      const adapter = new RedisStorageAdapter({
        client: mockClient,
        namespace: maliciousNamespace,
      });

      const redisKey = (adapter as any).redisKey;

      // Verify newlines were removed (FLUSHDB letters remain but can't be injected as command without newlines)
      expect(redisKey).not.toContain('\n');
      expect(redisKey).not.toContain('\r');
      // The key should be a single line, preventing command injection
      expect(redisKey.split('\n').length).toBe(1);
    });

    it('should sanitize namespace with carriage returns', () => {
      const mockClient = createMockRedisClient();
      const maliciousNamespace = 'test\rDEL *\r';
      const adapter = new RedisStorageAdapter({
        client: mockClient,
        namespace: maliciousNamespace,
      });

      const redisKey = (adapter as any).redisKey;

      // Verify carriage returns were removed
      expect(redisKey).not.toContain('\r');
      // The key should be a single line, preventing command injection
      expect(redisKey.split('\r').length).toBe(1);
    });

    it('should only allow safe characters in namespace', () => {
      const mockClient = createMockRedisClient();
      const unsafeNamespace = 'test!@#$%^&*()+=[]{}|;\'",<>?/\\`~';
      const adapter = new RedisStorageAdapter({
        client: mockClient,
        namespace: unsafeNamespace,
      });

      const redisKey = (adapter as any).redisKey;

      // Should only contain word characters, colons, dots, and dashes
      expect(redisKey).toMatch(/^[\w:.-]+$/);
    });
  });

  describe('Regular Expression Safety', () => {
    it('should detect nested quantifiers as vulnerable', () => {
      const vulnerablePattern = '(a+)+$';
      expect(isPotentiallyVulnerableRegex(vulnerablePattern)).toBe(true);
    });

    it('should detect alternation with quantifiers as vulnerable', () => {
      const vulnerablePattern = '(a|ab)*$';
      expect(isPotentiallyVulnerableRegex(vulnerablePattern)).toBe(true);
    });

    it('should not flag safe patterns as vulnerable', () => {
      const safePattern = '[a-zA-Z0-9]+';
      expect(isPotentiallyVulnerableRegex(safePattern)).toBe(false);
    });

    it('should provide safe regex patterns', () => {
      // Verify SAFE_PATTERNS are actually safe
      expect(isPotentiallyVulnerableRegex(SAFE_PATTERNS.CONTROL_CHARS.source)).toBe(false);
      expect(isPotentiallyVulnerableRegex(SAFE_PATTERNS.PATH_SEPARATORS.source)).toBe(false);
      expect(isPotentiallyVulnerableRegex(SAFE_PATTERNS.ALPHANUMERIC_SAFE.source)).toBe(false);
    });
  });

  describe('Error Message Configuration', () => {
    it('should support verboseErrors configuration', async () => {
      const dbVerbose = new VectoriaDB({ verboseErrors: true });
      const dbProduction = new VectoriaDB({ verboseErrors: false });

      await dbVerbose.initialize();
      await dbProduction.initialize();

      // Both should work the same, configuration is just for user reference
      expect(dbVerbose['config'].verboseErrors).toBe(true);
      expect(dbProduction['config'].verboseErrors).toBe(false);

      await dbVerbose.close();
      await dbProduction.close();
    });
  });

  describe('Security Integration', () => {
    it('should handle malicious input across multiple vectors simultaneously', async () => {
      // Create DB with all security limits
      const db = new VectoriaDB({
        maxDocuments: 5,
        maxDocumentSize: 50,
        maxBatchSize: 3,
        verboseErrors: false,
      });

      await db.initialize();

      // Try various attacks that should all be blocked
      const attacks = [
        // DoS via oversized document
        db.add('attack-1', 'x'.repeat(1000), { id: 'attack-1' }).catch((e) => e),

        // DoS via batch size
        db
          .addMany(
            Array.from({ length: 10 }, (_, i) => ({
              id: `attack-${i}`,
              text: 'test',
              metadata: { id: `attack-${i}` },
            })),
          )
          .catch((e) => e),
      ];

      const results = await Promise.all(attacks);

      // All attacks should be rejected
      expect(results.every((r) => r instanceof Error)).toBe(true);

      await db.close();
    });
  });
});
