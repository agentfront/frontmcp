/**
 * TransparentAuthorization Tests
 *
 * Tests the TransparentAuthorization class which represents pass-through OAuth token mode.
 * Covers fromVerifiedToken() with full payload, scope parsing, getToken(), issuer/audience,
 * provider snapshot creation, and authorization ID derivation.
 */

import { assertDefined } from '../../__test-utils__/assertion.helpers';

// ---- Mocks ----

const MOCK_SHA256 = 'abcdef0123456789abcdef0123456789';
jest.mock('@frontmcp/utils', () => ({
  sha256Hex: jest.fn(() => MOCK_SHA256),
  randomBytes: jest.fn(() => new Uint8Array(8)),
  bytesToHex: jest.fn(() => 'deadbeef01234567'),
}));

jest.mock('../../session/utils/session-crypto.utils', () => ({
  encryptJson: jest.fn(() => 'encrypted'),
}));

jest.mock('../../machine-id', () => ({
  getMachineId: jest.fn(() => 'machine-id-mock'),
}));

import { TransparentAuthorization } from '../transparent.authorization';
import type { TransparentAuthorizationCreateCtx } from '../transparent.authorization';

// ---- Helpers ----

const SAMPLE_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.signatureABC123';

function createDefaultCtx(
  overrides: Partial<TransparentAuthorizationCreateCtx> = {},
): TransparentAuthorizationCreateCtx {
  return {
    token: SAMPLE_TOKEN,
    payload: {
      sub: 'user-1',
      iss: 'https://auth.example.com',
      aud: 'my-app',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      scope: 'read write',
      name: 'Alice',
      email: 'alice@example.com',
      picture: 'https://example.com/alice.jpg',
    },
    providerId: 'auth0',
    providerName: 'Auth0',
    ...overrides,
  };
}

// ---- Tests ----

describe('TransparentAuthorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // fromVerifiedToken with full payload
  // ========================================
  describe('fromVerifiedToken() with full payload', () => {
    it('should create an instance with mode "transparent"', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      expect(auth.mode).toBe('transparent');
    });

    it('should not be anonymous', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      expect(auth.isAnonymous).toBe(false);
    });

    it('should extract user from payload', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      expect(auth.user).toEqual({
        sub: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        picture: 'https://example.com/alice.jpg',
        anonymous: false,
      });
    });

    it('should set claims from payload', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      const claims = auth.claims;
      assertDefined(claims);
      expect(claims['sub']).toBe('user-1');
      expect(claims['iss']).toBe('https://auth.example.com');
    });

    it('should calculate expiresAt from exp claim (seconds to ms)', () => {
      const expSeconds = Math.floor(Date.now() / 1000) + 3600;
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({ payload: { sub: 'u1', exp: expSeconds } }),
      );
      expect(auth.expiresAt).toBe(expSeconds * 1000);
    });

    it('should set expiresAt to undefined when no exp claim', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx({ payload: { sub: 'u1' } }));
      expect(auth.expiresAt).toBeUndefined();
    });

    it('should set providerId', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      expect(auth.providerId).toBe('auth0');
    });

    it('should set providerName', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      expect(auth.providerName).toBe('Auth0');
    });

    it('should leave providerName undefined when not provided', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx({ providerName: undefined }));
      expect(auth.providerName).toBeUndefined();
    });

    it('should derive authorization ID from token signature via sha256Hex', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      // Should be first 16 chars of the sha256Hex result
      expect(auth.id).toBe(MOCK_SHA256.substring(0, 16));
    });

    it('should pass projections through (authorizedTools)', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({
          authorizedTools: {
            search: { executionPath: ['app1', 'search'] },
          },
          authorizedToolIds: ['search'],
        }),
      );
      expect(auth.authorizedToolIds).toEqual(['search']);
      expect(auth.authorizedTools['search']).toBeDefined();
    });

    it('should pass projections through (authorizedPrompts)', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({
          authorizedPrompts: {
            greeting: { executionPath: ['app1', 'greeting'] },
          },
          authorizedPromptIds: ['greeting'],
        }),
      );
      expect(auth.authorizedPromptIds).toEqual(['greeting']);
    });

    it('should pass authorizedApps through', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({
          authorizedApps: { slack: { id: 'slack', toolIds: ['send'] } },
          authorizedAppIds: ['slack'],
        }),
      );
      expect(auth.authorizedAppIds).toEqual(['slack']);
    });

    it('should pass authorizedResources through', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({
          authorizedResources: ['file://docs', 'https://api.example.com'],
        }),
      );
      expect(auth.authorizedResources).toEqual(['file://docs', 'https://api.example.com']);
    });
  });

  // ========================================
  // Scope parsing
  // ========================================
  describe('scope parsing', () => {
    it('should parse space-separated string scopes', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({ payload: { sub: 'u1', scope: 'read write admin' } }),
      );
      expect(auth.scopes).toEqual(['read', 'write', 'admin']);
    });

    it('should parse array scopes as-is', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({ payload: { sub: 'u1', scope: ['read', 'write'] } }),
      );
      expect(auth.scopes).toEqual(['read', 'write']);
    });

    it('should return empty array for undefined scope', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx({ payload: { sub: 'u1' } }));
      expect(auth.scopes).toEqual([]);
    });

    it('should handle single scope string', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({ payload: { sub: 'u1', scope: 'read' } }),
      );
      expect(auth.scopes).toEqual(['read']);
    });

    it('should handle empty string scope', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx({ payload: { sub: 'u1', scope: '' } }));
      expect(auth.scopes).toEqual([]);
    });

    it('should handle multiple spaces between scopes', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({ payload: { sub: 'u1', scope: 'read   write' } }),
      );
      expect(auth.scopes).toEqual(['read', 'write']);
    });
  });

  // ========================================
  // getToken()
  // ========================================
  describe('getToken()', () => {
    it('should return the original token', async () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      const token = await auth.getToken();
      expect(token).toBe(SAMPLE_TOKEN);
    });

    it('should return the same token regardless of providerId', async () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      const token = await auth.getToken('some-provider');
      expect(token).toBe(SAMPLE_TOKEN);
    });
  });

  // ========================================
  // issuer / audience / hasAudience
  // ========================================
  describe('issuer / audience / hasAudience', () => {
    it('should return issuer from claims', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      expect(auth.issuer).toBe('https://auth.example.com');
    });

    it('should return undefined issuer when not in claims', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx({ payload: { sub: 'u1' } }));
      expect(auth.issuer).toBeUndefined();
    });

    it('should return audience from claims (string)', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      expect(auth.audience).toBe('my-app');
    });

    it('should return audience from claims (array)', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({ payload: { sub: 'u1', aud: ['app1', 'app2'] } }),
      );
      expect(auth.audience).toEqual(['app1', 'app2']);
    });

    it('should return undefined audience when not in claims', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx({ payload: { sub: 'u1' } }));
      expect(auth.audience).toBeUndefined();
    });

    it('hasAudience should return true for matching string audience', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      expect(auth.hasAudience('my-app')).toBe(true);
    });

    it('hasAudience should return false for non-matching string audience', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      expect(auth.hasAudience('other-app')).toBe(false);
    });

    it('hasAudience should return true for matching in array audience', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({ payload: { sub: 'u1', aud: ['app1', 'app2'] } }),
      );
      expect(auth.hasAudience('app2')).toBe(true);
    });

    it('hasAudience should return false for non-matching in array audience', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({ payload: { sub: 'u1', aud: ['app1', 'app2'] } }),
      );
      expect(auth.hasAudience('app3')).toBe(false);
    });

    it('hasAudience should return false when no audience set', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx({ payload: { sub: 'u1' } }));
      expect(auth.hasAudience('anything')).toBe(false);
    });
  });

  // ========================================
  // Provider snapshot
  // ========================================
  describe('provider snapshot', () => {
    it('should create provider snapshot with correct id', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      const snapshot = auth.authorizedProviders['auth0'];
      expect(snapshot).toBeDefined();
      expect(snapshot.id).toBe('auth0');
    });

    it('should set embedMode to plain in provider snapshot', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      const snapshot = auth.authorizedProviders['auth0'];
      expect(snapshot.embedMode).toBe('plain');
    });

    it('should include the token in provider snapshot', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      const snapshot = auth.authorizedProviders['auth0'];
      expect(snapshot.token).toBe(SAMPLE_TOKEN);
    });

    it('should set exp from payload in provider snapshot', () => {
      const expSeconds = Math.floor(Date.now() / 1000) + 3600;
      const auth = TransparentAuthorization.fromVerifiedToken(
        createDefaultCtx({ payload: { sub: 'u1', exp: expSeconds } }),
      );
      const snapshot = auth.authorizedProviders['auth0'];
      expect(snapshot.exp).toBe(expSeconds * 1000);
    });

    it('should include payload in provider snapshot', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      const snapshot = auth.authorizedProviders['auth0'];
      assertDefined(snapshot.payload);
      expect(snapshot.payload['sub']).toBe('user-1');
    });

    it('should set authorizedProviderIds to contain the providerId', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      expect(auth.authorizedProviderIds).toEqual(['auth0']);
    });
  });

  // ========================================
  // Authorization ID derivation
  // ========================================
  describe('authorization ID derivation', () => {
    it('should use sha256Hex of the token signature part', () => {
      const { sha256Hex } = require('@frontmcp/utils');
      TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      // The signature is the third part of the JWT
      expect(sha256Hex).toHaveBeenCalledWith('signatureABC123');
    });

    it('should use full token as fallback when no signature part', () => {
      const { sha256Hex } = require('@frontmcp/utils');
      const tokenNoSig = 'just-a-token';
      TransparentAuthorization.fromVerifiedToken(createDefaultCtx({ token: tokenNoSig }));
      // When no third part, falls back to full token
      expect(sha256Hex).toHaveBeenCalledWith(tokenNoSig);
    });

    it('should truncate to 16 characters', () => {
      const auth = TransparentAuthorization.fromVerifiedToken(createDefaultCtx());
      expect(auth.id).toHaveLength(16);
    });
  });
});
