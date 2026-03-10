/**
 * OrchestratedAuthAccessor Tests
 *
 * Tests the NullOrchestratedAuthAccessor and OrchestratedAuthAccessorAdapter classes.
 * Also tests the ORCHESTRATED_AUTH_ACCESSOR DI token.
 */

jest.mock('@frontmcp/utils', () => ({
  randomBytes: jest.fn(() => new Uint8Array(8)),
  bytesToHex: jest.fn(() => 'deadbeef01234567'),
}));

import {
  NullOrchestratedAuthAccessor,
  OrchestratedAuthAccessorAdapter,
  ORCHESTRATED_AUTH_ACCESSOR,
} from '../orchestrated.accessor';
import { OrchestratedAuthNotAvailableError } from '../../errors/auth-internal.errors';

// ============================================
// ORCHESTRATED_AUTH_ACCESSOR Token
// ============================================

describe('ORCHESTRATED_AUTH_ACCESSOR', () => {
  it('should be a symbol', () => {
    expect(typeof ORCHESTRATED_AUTH_ACCESSOR).toBe('symbol');
  });

  it('should have the correct description', () => {
    expect(ORCHESTRATED_AUTH_ACCESSOR.toString()).toContain('frontmcp:ORCHESTRATED_AUTH_ACCESSOR');
  });

  it('should be globally unique via Symbol.for', () => {
    const same = Symbol.for('frontmcp:ORCHESTRATED_AUTH_ACCESSOR');
    expect(ORCHESTRATED_AUTH_ACCESSOR).toBe(same);
  });
});

// ============================================
// NullOrchestratedAuthAccessor
// ============================================

describe('NullOrchestratedAuthAccessor', () => {
  let accessor: NullOrchestratedAuthAccessor;

  beforeEach(() => {
    accessor = new NullOrchestratedAuthAccessor();
  });

  describe('readonly properties', () => {
    it('should have primaryProviderId as undefined', () => {
      expect(accessor.primaryProviderId).toBeUndefined();
    });

    it('should have issuer as undefined', () => {
      expect(accessor.issuer).toBeUndefined();
    });

    it('should have authorizationId as "null"', () => {
      expect(accessor.authorizationId).toBe('null');
    });

    it('should have isAuthenticated as false', () => {
      expect(accessor.isAuthenticated).toBe(false);
    });
  });

  describe('getToken', () => {
    it('should throw OrchestratedAuthNotAvailableError', async () => {
      await expect(accessor.getToken()).rejects.toThrow(OrchestratedAuthNotAvailableError);
    });

    it('should throw OrchestratedAuthNotAvailableError with providerId', async () => {
      await expect(accessor.getToken('github')).rejects.toThrow(OrchestratedAuthNotAvailableError);
    });
  });

  describe('tryGetToken', () => {
    it('should return null', async () => {
      const result = await accessor.tryGetToken();
      expect(result).toBeNull();
    });

    it('should return null with providerId', async () => {
      const result = await accessor.tryGetToken('github');
      expect(result).toBeNull();
    });
  });

  describe('getAppToken', () => {
    it('should return null', async () => {
      const result = await accessor.getAppToken('my-app');
      expect(result).toBeNull();
    });
  });

  describe('hasProvider', () => {
    it('should return false', () => {
      expect(accessor.hasProvider('github')).toBe(false);
      expect(accessor.hasProvider('slack')).toBe(false);
    });
  });

  describe('getProviderIds', () => {
    it('should return empty array', () => {
      expect(accessor.getProviderIds()).toEqual([]);
    });
  });

  describe('isAppAuthorized', () => {
    it('should return false', () => {
      expect(accessor.isAppAuthorized('my-app')).toBe(false);
    });
  });

  describe('getAllAuthorizedAppIds', () => {
    it('should return empty array', () => {
      expect(accessor.getAllAuthorizedAppIds()).toEqual([]);
    });
  });

  describe('getAppToolIds', () => {
    it('should return undefined', () => {
      expect(accessor.getAppToolIds('my-app')).toBeUndefined();
    });
  });
});

// ============================================
// OrchestratedAuthAccessorAdapter
// ============================================

describe('OrchestratedAuthAccessorAdapter', () => {
  // ---- Mock authorization ----

  function createMockAuthorization(overrides: Record<string, unknown> = {}) {
    return {
      id: 'auth-id-123',
      isAnonymous: false,
      primaryProviderId: 'github',
      issuer: 'https://auth.example.com',
      hasProvider: jest.fn().mockReturnValue(true),
      getProviderIds: jest.fn().mockReturnValue(['github', 'slack']),
      getToken: jest.fn().mockResolvedValue('access-token-abc'),
      getAppToken: jest.fn().mockResolvedValue('app-token-xyz'),
      isAppAuthorized: jest.fn().mockReturnValue(true),
      getAllAuthorizedAppIds: jest.fn().mockReturnValue(['app-1', 'app-2']),
      getAppToolIds: jest.fn().mockReturnValue(['tool-a', 'tool-b']),
      ...overrides,
    };
  }

  describe('property accessors', () => {
    it('should expose primaryProviderId from authorization', () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);
      expect(adapter.primaryProviderId).toBe('github');
    });

    it('should expose issuer from authorization', () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);
      expect(adapter.issuer).toBe('https://auth.example.com');
    });

    it('should expose authorizationId from authorization.id', () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);
      expect(adapter.authorizationId).toBe('auth-id-123');
    });

    it('should return isAuthenticated as true when not anonymous', () => {
      const auth = createMockAuthorization({ isAnonymous: false });
      const adapter = new OrchestratedAuthAccessorAdapter(auth);
      expect(adapter.isAuthenticated).toBe(true);
    });

    it('should return isAuthenticated as false when anonymous', () => {
      const auth = createMockAuthorization({ isAnonymous: true });
      const adapter = new OrchestratedAuthAccessorAdapter(auth);
      expect(adapter.isAuthenticated).toBe(false);
    });

    it('should handle undefined primaryProviderId', () => {
      const auth = createMockAuthorization({ primaryProviderId: undefined });
      const adapter = new OrchestratedAuthAccessorAdapter(auth);
      expect(adapter.primaryProviderId).toBeUndefined();
    });

    it('should handle undefined issuer', () => {
      const auth = createMockAuthorization({ issuer: undefined });
      const adapter = new OrchestratedAuthAccessorAdapter(auth);
      expect(adapter.issuer).toBeUndefined();
    });
  });

  describe('getToken', () => {
    it('should delegate to authorization.getToken', async () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      const token = await adapter.getToken('github');
      expect(token).toBe('access-token-abc');
      expect(auth.getToken).toHaveBeenCalledWith('github');
    });

    it('should call getToken without providerId', async () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      await adapter.getToken();
      expect(auth.getToken).toHaveBeenCalledWith(undefined);
    });
  });

  describe('tryGetToken', () => {
    it('should return token on success', async () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      const token = await adapter.tryGetToken('github');
      expect(token).toBe('access-token-abc');
    });

    it('should return null when getToken throws', async () => {
      const auth = createMockAuthorization({
        getToken: jest.fn().mockRejectedValue(new Error('not available')),
      });
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      const token = await adapter.tryGetToken('nonexistent');
      expect(token).toBeNull();
    });

    it('should call tryGetToken without providerId', async () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      const token = await adapter.tryGetToken();
      expect(token).toBe('access-token-abc');
      expect(auth.getToken).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getAppToken', () => {
    it('should delegate to authorization.getAppToken', async () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      const token = await adapter.getAppToken('jira');
      expect(token).toBe('app-token-xyz');
      expect(auth.getAppToken).toHaveBeenCalledWith('jira');
    });

    it('should return null when authorization returns null', async () => {
      const auth = createMockAuthorization({
        getAppToken: jest.fn().mockResolvedValue(null),
      });
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      const token = await adapter.getAppToken('unknown-app');
      expect(token).toBeNull();
    });
  });

  describe('hasProvider', () => {
    it('should delegate to authorization.hasProvider', () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      expect(adapter.hasProvider('github')).toBe(true);
      expect(auth.hasProvider).toHaveBeenCalledWith('github');
    });

    it('should return false when authorization returns false', () => {
      const auth = createMockAuthorization({
        hasProvider: jest.fn().mockReturnValue(false),
      });
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      expect(adapter.hasProvider('nonexistent')).toBe(false);
    });
  });

  describe('getProviderIds', () => {
    it('should delegate to authorization.getProviderIds', () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      expect(adapter.getProviderIds()).toEqual(['github', 'slack']);
      expect(auth.getProviderIds).toHaveBeenCalled();
    });

    it('should return empty array when no providers', () => {
      const auth = createMockAuthorization({
        getProviderIds: jest.fn().mockReturnValue([]),
      });
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      expect(adapter.getProviderIds()).toEqual([]);
    });
  });

  describe('isAppAuthorized', () => {
    it('should delegate to authorization.isAppAuthorized', () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      expect(adapter.isAppAuthorized('app-1')).toBe(true);
      expect(auth.isAppAuthorized).toHaveBeenCalledWith('app-1');
    });

    it('should return false for unauthorized app', () => {
      const auth = createMockAuthorization({
        isAppAuthorized: jest.fn().mockReturnValue(false),
      });
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      expect(adapter.isAppAuthorized('unknown')).toBe(false);
    });
  });

  describe('getAllAuthorizedAppIds', () => {
    it('should delegate to authorization.getAllAuthorizedAppIds', () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      expect(adapter.getAllAuthorizedAppIds()).toEqual(['app-1', 'app-2']);
      expect(auth.getAllAuthorizedAppIds).toHaveBeenCalled();
    });
  });

  describe('getAppToolIds', () => {
    it('should delegate to authorization.getAppToolIds', () => {
      const auth = createMockAuthorization();
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      expect(adapter.getAppToolIds('app-1')).toEqual(['tool-a', 'tool-b']);
      expect(auth.getAppToolIds).toHaveBeenCalledWith('app-1');
    });

    it('should return undefined for unknown app', () => {
      const auth = createMockAuthorization({
        getAppToolIds: jest.fn().mockReturnValue(undefined),
      });
      const adapter = new OrchestratedAuthAccessorAdapter(auth);

      expect(adapter.getAppToolIds('unknown')).toBeUndefined();
    });
  });
});
