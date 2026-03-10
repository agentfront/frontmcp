/**
 * PublicAuthorization Tests
 *
 * Tests the PublicAuthorization class which represents anonymous/public access mode.
 * Covers create() with defaults/custom options, mode, isAnonymous, getToken(), allowsAll*,
 * canAccess*, and expiry from ttlMs.
 */

import { TokenNotAvailableError } from '../../errors/auth-internal.errors';

// ---- Mocks ----

const MOCK_UUID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';
jest.mock('@frontmcp/utils', () => ({
  randomUUID: jest.fn(() => MOCK_UUID),
  randomBytes: jest.fn(() => new Uint8Array(8)),
  bytesToHex: jest.fn(() => 'deadbeef01234567'),
}));

jest.mock('../../session/utils/session-crypto.utils', () => ({
  encryptJson: jest.fn(() => 'encrypted'),
}));

jest.mock('../../machine-id', () => ({
  getMachineId: jest.fn(() => 'machine-id-public'),
}));

import { PublicAuthorization } from '../public.authorization';

// ---- Tests ----

describe('PublicAuthorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // create() with defaults
  // ========================================
  describe('create() with defaults', () => {
    it('should create with default prefix "anon"', () => {
      const auth = PublicAuthorization.create();
      expect(auth.user.sub).toBe(`anon:${MOCK_UUID}`);
    });

    it('should have mode "public"', () => {
      const auth = PublicAuthorization.create();
      expect(auth.mode).toBe('public');
    });

    it('should be anonymous', () => {
      const auth = PublicAuthorization.create();
      expect(auth.isAnonymous).toBe(true);
    });

    it('should have user.anonymous set to true', () => {
      const auth = PublicAuthorization.create();
      expect(auth.user.anonymous).toBe(true);
    });

    it('should have user.name as "Anonymous"', () => {
      const auth = PublicAuthorization.create();
      expect(auth.user.name).toBe('Anonymous');
    });

    it('should default scopes to ["anonymous"]', () => {
      const auth = PublicAuthorization.create();
      expect(auth.scopes).toEqual(['anonymous']);
    });

    it('should set expiresAt based on default ttlMs (1 hour)', () => {
      const before = Date.now();
      const auth = PublicAuthorization.create();
      const after = Date.now();
      // Default is 3600000 ms = 1 hour
      expect(auth.expiresAt).toBeGreaterThanOrEqual(before + 3600000);
      expect(auth.expiresAt).toBeLessThanOrEqual(after + 3600000);
    });

    it('should set id to the generated sub', () => {
      const auth = PublicAuthorization.create();
      expect(auth.id).toBe(`anon:${MOCK_UUID}`);
    });

    it('should have issuer undefined by default', () => {
      const auth = PublicAuthorization.create();
      expect(auth.issuer).toBeUndefined();
    });

    it('should allow all tools by default (allowsAllTools)', () => {
      const auth = PublicAuthorization.create();
      expect(auth.allowsAllTools).toBe(true);
    });

    it('should allow all prompts by default (allowsAllPrompts)', () => {
      const auth = PublicAuthorization.create();
      expect(auth.allowsAllPrompts).toBe(true);
    });
  });

  // ========================================
  // create() with custom options
  // ========================================
  describe('create() with custom options', () => {
    it('should use custom prefix', () => {
      const auth = PublicAuthorization.create({ prefix: 'guest' });
      expect(auth.user.sub).toBe(`guest:${MOCK_UUID}`);
    });

    it('should use custom scopes', () => {
      const auth = PublicAuthorization.create({ scopes: ['read', 'browse'] });
      expect(auth.scopes).toEqual(['read', 'browse']);
    });

    it('should use custom ttlMs for expiresAt', () => {
      const before = Date.now();
      const auth = PublicAuthorization.create({ ttlMs: 5000 });
      const after = Date.now();
      expect(auth.expiresAt).toBeGreaterThanOrEqual(before + 5000);
      expect(auth.expiresAt).toBeLessThanOrEqual(after + 5000);
    });

    it('should set issuer when provided', () => {
      const auth = PublicAuthorization.create({ issuer: 'https://auth.example.com' });
      expect(auth.issuer).toBe('https://auth.example.com');
    });

    it('should set specific allowed tools', () => {
      const auth = PublicAuthorization.create({ allowedTools: ['search', 'get-docs'] });
      expect(auth.allowsAllTools).toBe(false);
      expect(auth.authorizedToolIds).toEqual(['search', 'get-docs']);
    });

    it('should build authorizedTools map for specific tools', () => {
      const auth = PublicAuthorization.create({ allowedTools: ['search'] });
      expect(auth.authorizedTools['search']).toEqual({
        executionPath: ['public', 'search'],
      });
    });

    it('should set specific allowed prompts', () => {
      const auth = PublicAuthorization.create({ allowedPrompts: ['greeting', 'help'] });
      expect(auth.allowsAllPrompts).toBe(false);
      expect(auth.authorizedPromptIds).toEqual(['greeting', 'help']);
    });

    it('should build authorizedPrompts map for specific prompts', () => {
      const auth = PublicAuthorization.create({ allowedPrompts: ['greeting'] });
      expect(auth.authorizedPrompts['greeting']).toEqual({
        executionPath: ['public', 'greeting'],
      });
    });

    it('should handle allowedTools="all" as default behavior', () => {
      const auth = PublicAuthorization.create({ allowedTools: 'all' });
      expect(auth.allowsAllTools).toBe(true);
      expect(auth.authorizedToolIds).toEqual([]);
    });

    it('should handle allowedPrompts="all" as default behavior', () => {
      const auth = PublicAuthorization.create({ allowedPrompts: 'all' });
      expect(auth.allowsAllPrompts).toBe(true);
      expect(auth.authorizedPromptIds).toEqual([]);
    });
  });

  // ========================================
  // getToken()
  // ========================================
  describe('getToken()', () => {
    it('should throw TokenNotAvailableError', async () => {
      const auth = PublicAuthorization.create();
      await expect(auth.getToken()).rejects.toThrow(TokenNotAvailableError);
    });

    it('should throw with descriptive message', async () => {
      const auth = PublicAuthorization.create();
      await expect(auth.getToken()).rejects.toThrow(/Anonymous users cannot access provider tokens/);
    });

    it('should throw even when providerId is given', async () => {
      const auth = PublicAuthorization.create();
      await expect(auth.getToken('github')).rejects.toThrow(TokenNotAvailableError);
    });
  });

  // ========================================
  // allowsAllTools / allowsAllPrompts
  // ========================================
  describe('allowsAllTools / allowsAllPrompts', () => {
    it('allowsAllTools is true when no tools defined', () => {
      const auth = PublicAuthorization.create();
      expect(auth.allowsAllTools).toBe(true);
    });

    it('allowsAllTools is false when specific tools are defined', () => {
      const auth = PublicAuthorization.create({ allowedTools: ['search'] });
      expect(auth.allowsAllTools).toBe(false);
    });

    it('allowsAllPrompts is true when no prompts defined', () => {
      const auth = PublicAuthorization.create();
      expect(auth.allowsAllPrompts).toBe(true);
    });

    it('allowsAllPrompts is false when specific prompts are defined', () => {
      const auth = PublicAuthorization.create({ allowedPrompts: ['help'] });
      expect(auth.allowsAllPrompts).toBe(false);
    });
  });

  // ========================================
  // canAccessTool / canAccessPrompt
  // ========================================
  describe('canAccessTool / canAccessPrompt', () => {
    it('canAccessTool returns true for any tool when allowsAllTools', () => {
      const auth = PublicAuthorization.create();
      expect(auth.canAccessTool('anything')).toBe(true);
      expect(auth.canAccessTool('search')).toBe(true);
    });

    it('canAccessTool returns true for authorized tool when specific tools set', () => {
      const auth = PublicAuthorization.create({ allowedTools: ['search', 'list'] });
      expect(auth.canAccessTool('search')).toBe(true);
      expect(auth.canAccessTool('list')).toBe(true);
    });

    it('canAccessTool returns false for unauthorized tool when specific tools set', () => {
      const auth = PublicAuthorization.create({ allowedTools: ['search'] });
      expect(auth.canAccessTool('delete')).toBe(false);
    });

    it('canAccessPrompt returns true for any prompt when allowsAllPrompts', () => {
      const auth = PublicAuthorization.create();
      expect(auth.canAccessPrompt('anything')).toBe(true);
    });

    it('canAccessPrompt returns true for authorized prompt when specific prompts set', () => {
      const auth = PublicAuthorization.create({ allowedPrompts: ['help'] });
      expect(auth.canAccessPrompt('help')).toBe(true);
    });

    it('canAccessPrompt returns false for unauthorized prompt when specific prompts set', () => {
      const auth = PublicAuthorization.create({ allowedPrompts: ['help'] });
      expect(auth.canAccessPrompt('admin-prompt')).toBe(false);
    });
  });

  // ========================================
  // Expiry from ttlMs
  // ========================================
  describe('expiry from ttlMs', () => {
    it('should not be expired immediately after creation with default ttl', () => {
      const auth = PublicAuthorization.create();
      expect(auth.isExpired()).toBe(false);
    });

    it('should not be expired immediately after creation with custom ttl', () => {
      const auth = PublicAuthorization.create({ ttlMs: 10000 });
      expect(auth.isExpired()).toBe(false);
    });

    it('should have expiresAt in the future', () => {
      const auth = PublicAuthorization.create({ ttlMs: 5000 });
      expect(auth.expiresAt).toBeGreaterThan(Date.now());
    });
  });
});
