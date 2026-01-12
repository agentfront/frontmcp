/**
 * E2E Tests for Cross-Package Imports
 *
 * Tests that imports work correctly across the split packages:
 * - @frontmcp/auth exports work correctly
 * - @frontmcp/utils exports work correctly
 * - @frontmcp/sdk re-exports from @frontmcp/auth
 * - Type compatibility across packages
 *
 * These tests ensure the package split maintains a proper export structure.
 */
import { test, expect } from '@frontmcp/testing';

// Import from @frontmcp/auth directly
import {
  JwksService,
  InMemoryAuthorizationVault,
  StorageAuthorizationVault,
  TypedStorage,
  VaultEncryption,
  TinyTtlCache,
  authUserSchema,
  credentialTypeSchema,
} from '@frontmcp/auth';

// Import from @frontmcp/utils directly
import {
  MemoryStorageAdapter,
  hkdfSha256,
  encryptAesGcm,
  decryptAesGcm,
  randomBytes,
  sha256,
  base64urlEncode,
  base64urlDecode,
} from '@frontmcp/utils';

// Import from @frontmcp/sdk (should re-export auth types)
import { FrontMcp, Tool, ToolContext, Resource, ResourceContext, Prompt, PromptContext, App } from '@frontmcp/sdk';

test.describe('Cross-Package Imports E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-config/src/main.ts',
    publicMode: true,
  });

  test.describe('@frontmcp/auth Exports', () => {
    test('should export JwksService class', () => {
      expect(JwksService).toBeDefined();
      expect(typeof JwksService).toBe('function');
    });

    test('should export InMemoryAuthorizationVault class', () => {
      expect(InMemoryAuthorizationVault).toBeDefined();
      expect(typeof InMemoryAuthorizationVault).toBe('function');
    });

    test('should export StorageAuthorizationVault class', () => {
      expect(StorageAuthorizationVault).toBeDefined();
      expect(typeof StorageAuthorizationVault).toBe('function');
    });

    test('should export TypedStorage class', () => {
      expect(TypedStorage).toBeDefined();
      expect(typeof TypedStorage).toBe('function');
    });

    test('should export VaultEncryption class', () => {
      expect(VaultEncryption).toBeDefined();
      expect(typeof VaultEncryption).toBe('function');
    });

    test('should export TinyTtlCache class', () => {
      expect(TinyTtlCache).toBeDefined();
      expect(typeof TinyTtlCache).toBe('function');
    });

    test('should export Zod schemas', () => {
      expect(authUserSchema).toBeDefined();
      expect(credentialTypeSchema).toBeDefined();
    });
  });

  test.describe('@frontmcp/utils Exports', () => {
    test('should export MemoryStorageAdapter class', () => {
      expect(MemoryStorageAdapter).toBeDefined();
      expect(typeof MemoryStorageAdapter).toBe('function');
    });

    test('should export crypto functions', () => {
      expect(hkdfSha256).toBeDefined();
      expect(encryptAesGcm).toBeDefined();
      expect(decryptAesGcm).toBeDefined();
      expect(randomBytes).toBeDefined();
      expect(sha256).toBeDefined();
    });

    test('should export base64url encoding functions', () => {
      expect(base64urlEncode).toBeDefined();
      expect(base64urlDecode).toBeDefined();
    });
  });

  test.describe('@frontmcp/sdk Exports', () => {
    test('should export FrontMcp decorator', () => {
      expect(FrontMcp).toBeDefined();
    });

    test('should export Tool decorator and context', () => {
      expect(Tool).toBeDefined();
      expect(ToolContext).toBeDefined();
    });

    test('should export Resource decorator and context', () => {
      expect(Resource).toBeDefined();
      expect(ResourceContext).toBeDefined();
    });

    test('should export Prompt decorator and context', () => {
      expect(Prompt).toBeDefined();
      expect(PromptContext).toBeDefined();
    });

    test('should export App decorator', () => {
      expect(App).toBeDefined();
    });
  });

  test.describe('Instantiation Tests', () => {
    test('should instantiate InMemoryAuthorizationVault', async () => {
      const vault = new InMemoryAuthorizationVault();
      expect(vault).toBeDefined();

      // Should be able to create an entry
      const entry = await vault.create({
        userSub: 'test-user',
        clientId: 'test-client',
      });
      expect(entry.id).toBeDefined();
      expect(entry.userSub).toBe('test-user');
    });

    test('should instantiate MemoryStorageAdapter', () => {
      const adapter = new MemoryStorageAdapter();
      expect(adapter).toBeDefined();
    });

    test('should instantiate StorageAuthorizationVault with adapter', async () => {
      const adapter = new MemoryStorageAdapter();
      await adapter.connect(); // Must connect before use
      const vault = new StorageAuthorizationVault(adapter);
      expect(vault).toBeDefined();

      // Should be able to create an entry
      const entry = await vault.create({
        userSub: 'storage-user',
        clientId: 'storage-client',
      });
      expect(entry.id).toBeDefined();
    });

    test('should instantiate TypedStorage', async () => {
      const adapter = new MemoryStorageAdapter();
      await adapter.connect(); // Must connect before use
      const storage = new TypedStorage<{ name: string }>(adapter);
      expect(storage).toBeDefined();

      // Should be able to set and get data
      await storage.set('test-key', { name: 'test-value' });
      const value = await storage.get('test-key');
      expect(value).toEqual({ name: 'test-value' });
    });

    test('should instantiate TinyTtlCache', async () => {
      const cache = new TinyTtlCache<string, string>(1000);
      expect(cache).toBeDefined();

      // Should be able to set and get values
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });
  });

  test.describe('Crypto Function Tests', () => {
    test('should perform HKDF key derivation', () => {
      const encoder = new TextEncoder();
      const ikm = encoder.encode('input-key-material');
      const salt = encoder.encode('salt');
      const info = encoder.encode('info');

      const derivedKey = hkdfSha256(ikm, salt, info, 32);
      expect(derivedKey).toBeDefined();
      expect(derivedKey.length).toBe(32);
    });

    test('should encrypt and decrypt with AES-GCM', () => {
      const key = randomBytes(32);
      const iv = randomBytes(12); // AES-GCM requires 12-byte IV
      const plaintext = 'Hello, World!';
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      // encryptAesGcm signature: (key, plaintext, iv)
      const encrypted = encryptAesGcm(key, encoder.encode(plaintext), iv);
      expect(encrypted).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.tag).toBeDefined();

      // decryptAesGcm needs the same iv, ciphertext, and tag
      const decrypted = decryptAesGcm(key, encrypted.ciphertext, iv, encrypted.tag);
      expect(decoder.decode(decrypted)).toBe(plaintext);
    });

    test('should generate random bytes', () => {
      const bytes16 = randomBytes(16);
      const bytes32 = randomBytes(32);

      expect(bytes16.length).toBe(16);
      expect(bytes32.length).toBe(32);

      // Should be different each time
      const bytes16_2 = randomBytes(16);
      expect(bytes16).not.toEqual(bytes16_2);
    });

    test('should compute SHA256 hash', () => {
      const hash = sha256('test message');
      expect(hash).toBeDefined();
      expect(hash.length).toBe(32);
    });

    test('should encode/decode base64url', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 255, 254, 253]);
      const encoded = base64urlEncode(original);
      const decoded = base64urlDecode(encoded);

      expect(encoded).toBeDefined();
      expect(decoded).toEqual(original);
    });
  });

  test.describe('Schema Validation Tests', () => {
    test('should validate authUser schema', () => {
      const validUser = {
        sub: 'user-123',
        email: 'user@example.com',
        name: 'Test User',
      };

      const result = authUserSchema.safeParse(validUser);
      expect(result.success).toBe(true);
    });

    test('should validate credentialType schema', () => {
      const validTypes = ['oauth', 'api_key', 'bearer', 'basic', 'private_key'];

      for (const type of validTypes) {
        const result = credentialTypeSchema.safeParse(type);
        expect(result.success).toBe(true);
      }

      const invalidResult = credentialTypeSchema.safeParse('invalid_type');
      expect(invalidResult.success).toBe(false);
    });
  });

  test.describe('Integration with MCP Server', () => {
    test('should connect and list tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toBeDefined();
      // demo-e2e-config has several config-related tools
      expect(tools).toContainTool('get-config');
    });

    test('should call a tool successfully', async ({ mcp }) => {
      // Test actually calling a tool to verify full integration
      const result = await mcp.tools.call('get-config', {
        key: 'NODE_ENV',
        defaultValue: 'test',
      });
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('NODE_ENV');
    });
  });
});
