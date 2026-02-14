/**
 * Session Crypto Tests
 *
 * Tests for session signing, verification, and secret resolution logic.
 */

import { SessionSecretRequiredError } from '../../errors/auth-internal.errors';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSignData = jest.fn();
const mockVerifyData = jest.fn();
const mockIsSignedData = jest.fn();
const mockVerifyOrParseData = jest.fn();

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  signData: (...args: unknown[]) => mockSignData(...args),
  verifyData: (...args: unknown[]) => mockVerifyData(...args),
  isSignedData: (...args: unknown[]) => mockIsSignedData(...args),
  verifyOrParseData: (...args: unknown[]) => mockVerifyOrParseData(...args),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { signSession, verifySession, isSignedSession, verifyOrParseSession } from '../session-crypto';
import type { StoredSession } from '../transport-session.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeSession(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    session: {
      id: 'sess-1',
      authorizationId: 'auth-1',
      protocol: 'streamable-http',
      createdAt: Date.now(),
      nodeId: 'node-1',
    },
    authorizationId: 'auth-1',
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session-crypto', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset env vars touched by the module
    delete process.env['MCP_SESSION_SECRET'];
    delete process.env['NODE_ENV'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // -----------------------------------------------------------------------
  // signSession
  // -----------------------------------------------------------------------
  describe('signSession', () => {
    it('should delegate to signData with resolved secret', () => {
      const session = makeFakeSession();
      mockSignData.mockReturnValue('{"data":{},"sig":"abc","v":1}');

      const result = signSession(session, { secret: 'my-secret' });

      expect(mockSignData).toHaveBeenCalledTimes(1);
      expect(mockSignData).toHaveBeenCalledWith(session, { secret: 'my-secret' });
      expect(result).toBe('{"data":{},"sig":"abc","v":1}');
    });

    it('should use MCP_SESSION_SECRET env var when no explicit secret', () => {
      process.env['MCP_SESSION_SECRET'] = 'env-secret';
      const session = makeFakeSession();
      mockSignData.mockReturnValue('signed');

      signSession(session);

      expect(mockSignData).toHaveBeenCalledWith(session, { secret: 'env-secret' });
    });

    it('should use dev fallback secret when no secret and not production', () => {
      const session = makeFakeSession();
      mockSignData.mockReturnValue('signed');
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      signSession(session);

      expect(mockSignData).toHaveBeenCalledWith(session, {
        secret: 'insecure-dev-secret-do-not-use-in-production',
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('MCP_SESSION_SECRET not set'));
      warnSpy.mockRestore();
    });

    it('should throw SessionSecretRequiredError in production when no secret', () => {
      process.env['NODE_ENV'] = 'production';
      const session = makeFakeSession();

      expect(() => signSession(session)).toThrow(SessionSecretRequiredError);
    });

    it('should prefer explicit secret over env var', () => {
      process.env['MCP_SESSION_SECRET'] = 'env-secret';
      const session = makeFakeSession();
      mockSignData.mockReturnValue('signed');

      signSession(session, { secret: 'explicit-secret' });

      expect(mockSignData).toHaveBeenCalledWith(session, { secret: 'explicit-secret' });
    });
  });

  // -----------------------------------------------------------------------
  // verifySession
  // -----------------------------------------------------------------------
  describe('verifySession', () => {
    it('should delegate to verifyData and return session', () => {
      const session = makeFakeSession();
      mockVerifyData.mockReturnValue(session);

      const result = verifySession('signed-data', { secret: 'my-secret' });

      expect(mockVerifyData).toHaveBeenCalledTimes(1);
      expect(mockVerifyData).toHaveBeenCalledWith('signed-data', { secret: 'my-secret' });
      expect(result).toBe(session);
    });

    it('should return null when verifyData returns null (tampered)', () => {
      mockVerifyData.mockReturnValue(null);

      const result = verifySession('tampered-data', { secret: 'my-secret' });

      expect(result).toBeNull();
    });

    it('should resolve secret from env when not provided', () => {
      process.env['MCP_SESSION_SECRET'] = 'from-env';
      mockVerifyData.mockReturnValue(null);

      verifySession('signed-data');

      expect(mockVerifyData).toHaveBeenCalledWith('signed-data', { secret: 'from-env' });
    });

    it('should throw in production when no secret available', () => {
      process.env['NODE_ENV'] = 'production';

      expect(() => verifySession('signed-data')).toThrow(SessionSecretRequiredError);
    });
  });

  // -----------------------------------------------------------------------
  // signSession + verifySession round-trip
  // -----------------------------------------------------------------------
  describe('signSession + verifySession round-trip', () => {
    it('should round-trip with explicit secret', () => {
      const session = makeFakeSession();
      const signedJson = '{"data":{"session":{}},"sig":"valid","v":1}';

      mockSignData.mockReturnValue(signedJson);
      mockVerifyData.mockReturnValue(session);

      const signed = signSession(session, { secret: 'round-trip-secret' });
      const verified = verifySession(signed, { secret: 'round-trip-secret' });

      expect(verified).toBe(session);
    });
  });

  // -----------------------------------------------------------------------
  // isSignedSession (re-export of isSignedData)
  // -----------------------------------------------------------------------
  describe('isSignedSession', () => {
    it('should delegate to isSignedData', () => {
      mockIsSignedData.mockReturnValue(true);

      const result = isSignedSession('{"data":{},"sig":"abc","v":1}');

      expect(mockIsSignedData).toHaveBeenCalledWith('{"data":{},"sig":"abc","v":1}');
      expect(result).toBe(true);
    });

    it('should return false for unsigned data', () => {
      mockIsSignedData.mockReturnValue(false);

      const result = isSignedSession('{"session":{}}');

      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // verifyOrParseSession
  // -----------------------------------------------------------------------
  describe('verifyOrParseSession', () => {
    it('should delegate to verifyOrParseData with resolved secret', () => {
      const session = makeFakeSession();
      mockVerifyOrParseData.mockReturnValue(session);

      const result = verifyOrParseSession('data-string', { secret: 'my-secret' });

      expect(mockVerifyOrParseData).toHaveBeenCalledWith('data-string', { secret: 'my-secret' });
      expect(result).toBe(session);
    });

    it('should handle signed data (backwards compat)', () => {
      const session = makeFakeSession();
      mockVerifyOrParseData.mockReturnValue(session);

      const result = verifyOrParseSession('{"data":{},"sig":"x","v":1}', { secret: 's' });

      expect(result).toBe(session);
    });

    it('should handle unsigned JSON (backwards compat)', () => {
      const session = makeFakeSession();
      mockVerifyOrParseData.mockReturnValue(session);

      const result = verifyOrParseSession(JSON.stringify(session), { secret: 's' });

      expect(result).toBe(session);
    });

    it('should return null when verifyOrParseData returns null', () => {
      mockVerifyOrParseData.mockReturnValue(null);

      const result = verifyOrParseSession('invalid', { secret: 's' });

      expect(result).toBeNull();
    });

    it('should resolve secret from env var MCP_SESSION_SECRET', () => {
      process.env['MCP_SESSION_SECRET'] = 'env-key';
      mockVerifyOrParseData.mockReturnValue(null);

      verifyOrParseSession('data');

      expect(mockVerifyOrParseData).toHaveBeenCalledWith('data', { secret: 'env-key' });
    });

    it('should use dev fallback in non-production without secret', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockVerifyOrParseData.mockReturnValue(null);

      verifyOrParseSession('data');

      expect(mockVerifyOrParseData).toHaveBeenCalledWith('data', {
        secret: 'insecure-dev-secret-do-not-use-in-production',
      });
      warnSpy.mockRestore();
    });

    it('should throw SessionSecretRequiredError in production without secret', () => {
      process.env['NODE_ENV'] = 'production';

      expect(() => verifyOrParseSession('data')).toThrow(SessionSecretRequiredError);
    });
  });

  // -----------------------------------------------------------------------
  // Secret resolution edge cases
  // -----------------------------------------------------------------------
  describe('secret resolution', () => {
    it('should treat empty string config secret as falsy, fallback to env', () => {
      process.env['MCP_SESSION_SECRET'] = 'env-val';
      mockSignData.mockReturnValue('signed');

      signSession(makeFakeSession(), { secret: '' });

      expect(mockSignData).toHaveBeenCalledWith(expect.anything(), { secret: 'env-val' });
    });

    it('should treat empty string env var as falsy, use dev fallback', () => {
      process.env['MCP_SESSION_SECRET'] = '';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockSignData.mockReturnValue('signed');

      signSession(makeFakeSession());

      expect(mockSignData).toHaveBeenCalledWith(expect.anything(), {
        secret: 'insecure-dev-secret-do-not-use-in-production',
      });
      warnSpy.mockRestore();
    });

    it('console.warn is called exactly once per dev fallback resolution', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockSignData.mockReturnValue('s');

      signSession(makeFakeSession());

      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });
});
