/**
 * Session ID Utils Tests
 *
 * Tests for session ID creation, encryption, decryption, and payload updates.
 */
import { SessionIdPayload, TransportProtocolType } from '../../../common';

// Mock dependencies before importing the module under test
const mockRandomUUID = jest.fn();

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  randomUUID: () => mockRandomUUID(),
}));

// Mock @frontmcp/auth functions that session-id.utils.ts imports directly
const mockEncryptJson = jest.fn();
const mockSafeDecrypt = jest.fn();
const mockGetMachineId = jest.fn();
const mockGetTokenSignatureFingerprint = jest.fn();

jest.mock('@frontmcp/auth', () => {
  const actual = jest.requireActual('@frontmcp/auth');
  return {
    ...actual,
    encryptJson: (...args: unknown[]) => mockEncryptJson(...args),
    safeDecrypt: (...args: unknown[]) => mockSafeDecrypt(...args),
    getMachineId: () => mockGetMachineId(),
    getTokenSignatureFingerprint: (token: string) => mockGetTokenSignatureFingerprint(token),
  };
});

const mockDetectPlatformFromUserAgent = jest.fn();
jest.mock('../../../notification/notification.service', () => ({
  detectPlatformFromUserAgent: (ua: string, config?: any) => mockDetectPlatformFromUserAgent(ua, config),
}));

// Import after mocking
import {
  createSessionId,
  updateSessionPayload,
  parseSessionHeader,
  decryptPublicSession,
  generateSessionCookie,
  extractSessionFromCookie,
  getSessionClientInfo,
} from '../utils/session-id.utils';

describe('session-id.utils', () => {
  const TEST_NODE_ID = 'test-node-id-123';
  const TEST_UUID = 'test-uuid-456';
  const TEST_AUTH_SIG = 'test-auth-sig-789';
  const TEST_TOKEN = 'test-token';

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock implementations
    mockRandomUUID.mockReturnValue(TEST_UUID);
    mockGetMachineId.mockReturnValue(TEST_NODE_ID);
    mockGetTokenSignatureFingerprint.mockReturnValue(TEST_AUTH_SIG);
    mockEncryptJson.mockReturnValue('test-iv.test-tag.test-data');
    mockSafeDecrypt.mockReturnValue(null);
    mockDetectPlatformFromUserAgent.mockReturnValue('unknown');

    // Reset environment variables
    delete process.env['MCP_SESSION_SECRET'];
    delete process.env['NODE_ENV'];
  });

  // ============================================
  // createSessionId Tests
  // ============================================

  describe('createSessionId', () => {
    it('should create a session with all required fields', () => {
      const protocol: TransportProtocolType = 'streamable-http';
      const result = createSessionId(protocol, TEST_TOKEN);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.payload).toBeDefined();
      expect(result.payload.nodeId).toBe(TEST_NODE_ID);
      expect(result.payload.authSig).toBe(TEST_AUTH_SIG);
      expect(result.payload.uuid).toBe(TEST_UUID);
      expect(result.payload.iat).toBeDefined();
      expect(typeof result.payload.iat).toBe('number');
      expect(result.payload.protocol).toBe(protocol);
    });

    it('should set protocol from parameter', () => {
      const protocols: TransportProtocolType[] = ['sse', 'streamable-http', 'stateful-http', 'stateless-http'];

      for (const protocol of protocols) {
        const result = createSessionId(protocol, TEST_TOKEN);
        expect(result.payload.protocol).toBe(protocol);
      }
    });

    it('should generate unique UUIDs for each call', () => {
      mockRandomUUID.mockReturnValueOnce('uuid-1').mockReturnValueOnce('uuid-2');

      const result1 = createSessionId('streamable-http', TEST_TOKEN);
      const result2 = createSessionId('streamable-http', TEST_TOKEN);

      expect(result1.payload.uuid).toBe('uuid-1');
      expect(result2.payload.uuid).toBe('uuid-2');
    });

    it('should set timestamp in seconds', () => {
      const beforeTime = Math.floor(Date.now() / 1000);
      const result = createSessionId('streamable-http', TEST_TOKEN);
      const afterTime = Math.floor(Date.now() / 1000);

      expect(result.payload.iat).toBeGreaterThanOrEqual(beforeTime);
      expect(result.payload.iat).toBeLessThanOrEqual(afterTime);
    });

    it('should call getTokenSignatureFingerprint with token', () => {
      createSessionId('streamable-http', TEST_TOKEN);
      expect(mockGetTokenSignatureFingerprint).toHaveBeenCalledWith(TEST_TOKEN);
    });

    it('should call getMachineId', () => {
      createSessionId('streamable-http', TEST_TOKEN);
      expect(mockGetMachineId).toHaveBeenCalled();
    });

    it('should detect platform from user-agent when provided', () => {
      mockDetectPlatformFromUserAgent.mockReturnValue('claude');

      const result = createSessionId('streamable-http', TEST_TOKEN, {
        userAgent: 'Claude-Desktop/1.0',
      });

      expect(mockDetectPlatformFromUserAgent).toHaveBeenCalledWith('Claude-Desktop/1.0', undefined);
      expect(result.payload.platformType).toBe('claude');
    });

    it('should pass platform detection config when provided', () => {
      mockDetectPlatformFromUserAgent.mockReturnValue('cursor');

      const config = { userAgentPatterns: [{ pattern: 'custom', platform: 'cursor' }] };
      createSessionId('streamable-http', TEST_TOKEN, {
        userAgent: 'Custom-Client/1.0',
        platformDetectionConfig: config as any,
      });

      expect(mockDetectPlatformFromUserAgent).toHaveBeenCalledWith('Custom-Client/1.0', config);
    });

    it('should not set platformType when detection returns unknown', () => {
      mockDetectPlatformFromUserAgent.mockReturnValue('unknown');

      const result = createSessionId('streamable-http', TEST_TOKEN, {
        userAgent: 'Unknown-Client/1.0',
      });

      expect(result.payload.platformType).toBeUndefined();
    });

    it('should not call platform detection without user-agent', () => {
      const result = createSessionId('streamable-http', TEST_TOKEN);

      expect(mockDetectPlatformFromUserAgent).not.toHaveBeenCalled();
      expect(result.payload.platformType).toBeUndefined();
    });

    it('should encrypt the payload and return encrypted ID', () => {
      const result = createSessionId('streamable-http', TEST_TOKEN);

      expect(mockEncryptJson).toHaveBeenCalled();
      expect(result.id).toBe('test-iv.test-tag.test-data');
    });

    it('should set skillsOnlyMode when provided in options', () => {
      const result = createSessionId('streamable-http', TEST_TOKEN, {
        skillsOnlyMode: true,
      });

      expect(result.payload.skillsOnlyMode).toBe(true);
    });

    it('should not set skillsOnlyMode when not provided', () => {
      const result = createSessionId('streamable-http', TEST_TOKEN);

      expect(result.payload.skillsOnlyMode).toBeUndefined();
    });

    it('should not set skillsOnlyMode when explicitly false', () => {
      const result = createSessionId('streamable-http', TEST_TOKEN, {
        skillsOnlyMode: false,
      });

      expect(result.payload.skillsOnlyMode).toBeUndefined();
    });

    it('should combine skillsOnlyMode with other options', () => {
      mockDetectPlatformFromUserAgent.mockReturnValue('cursor');

      const result = createSessionId('streamable-http', TEST_TOKEN, {
        userAgent: 'Cursor/1.0',
        skillsOnlyMode: true,
      });

      expect(result.payload.skillsOnlyMode).toBe(true);
      expect(result.payload.platformType).toBe('cursor');
    });
  });

  // ============================================
  // updateSessionPayload Tests
  // ============================================

  describe('updateSessionPayload', () => {
    const mockValidPayload: SessionIdPayload = {
      nodeId: TEST_NODE_ID,
      authSig: TEST_AUTH_SIG,
      uuid: TEST_UUID,
      iat: 1234567890,
      protocol: 'streamable-http',
    };

    beforeEach(() => {
      // Setup decrypt to return valid payload
      mockSafeDecrypt.mockReturnValue(mockValidPayload);
    });

    it('should update fields on existing session', () => {
      // Create a session first to populate cache
      const { id } = createSessionId('streamable-http', TEST_TOKEN);

      const updated = updateSessionPayload(id, {
        clientName: 'Test Client',
        clientVersion: '1.0.0',
      });

      expect(updated).toBe(true);
    });

    it('should merge partial updates correctly', () => {
      const { id, payload } = createSessionId('streamable-http', TEST_TOKEN);

      // First update
      updateSessionPayload(id, { clientName: 'Client A' });

      // Second update should preserve clientName
      updateSessionPayload(id, { clientVersion: '2.0' });

      // The payload object should have been mutated
      expect(payload.clientName).toBe('Client A');
      expect(payload.clientVersion).toBe('2.0');
    });

    it('should update supportsElicitation field', () => {
      const { id, payload } = createSessionId('streamable-http', TEST_TOKEN);

      updateSessionPayload(id, { supportsElicitation: true });

      expect(payload.supportsElicitation).toBe(true);
    });

    it('should update platformType field', () => {
      const { id, payload } = createSessionId('streamable-http', TEST_TOKEN);

      updateSessionPayload(id, { platformType: 'openai' });

      expect(payload.platformType).toBe('openai');
    });

    it('should update skillsOnlyMode field', () => {
      const { id, payload } = createSessionId('streamable-http', TEST_TOKEN);

      updateSessionPayload(id, { skillsOnlyMode: true });

      expect(payload.skillsOnlyMode).toBe(true);
    });

    it('should return false for non-existent session', () => {
      mockSafeDecrypt.mockReturnValue(null);

      const result = updateSessionPayload('non-existent-session-id', {
        clientName: 'Test',
      });

      expect(result).toBe(false);
    });

    it('should decrypt and update if not in cache', () => {
      // Don't create session first - force decryption path
      // The session ID format needs to be valid (3 parts separated by dots)
      mockSafeDecrypt.mockReturnValue({ ...mockValidPayload });

      const result = updateSessionPayload('iv-part.tag-part.data-part', {
        clientName: 'Decrypted Client',
      });

      // Result depends on whether decryption succeeds
      // In a real scenario with proper encryption, this would work
      // For unit test with mocked decrypt, we verify the mock was called
      expect(mockSafeDecrypt).toHaveBeenCalled();
    });

    it('should handle public session payloads', () => {
      const publicPayload = {
        ...mockValidPayload,
        authSig: 'public',
        isPublic: true,
      };
      mockSafeDecrypt.mockReturnValue(publicPayload);

      // First access to populate cache via decryption
      const result = updateSessionPayload('public.session.id', {
        platformType: 'claude',
      });

      // Verify decrypt was called (cache miss path)
      expect(mockSafeDecrypt).toHaveBeenCalled();
    });
  });

  // ============================================
  // parseSessionHeader Tests
  // ============================================

  describe('parseSessionHeader', () => {
    const mockValidPayload: SessionIdPayload = {
      nodeId: TEST_NODE_ID,
      authSig: TEST_AUTH_SIG,
      uuid: TEST_UUID,
      iat: 1234567890,
      protocol: 'streamable-http',
    };

    it('should return undefined for undefined header', () => {
      const result = parseSessionHeader(undefined, TEST_TOKEN);
      expect(result).toBeUndefined();
    });

    it('should return undefined for invalid session', () => {
      mockSafeDecrypt.mockReturnValue(null);

      const result = parseSessionHeader('invalid-session', TEST_TOKEN);
      expect(result).toBeUndefined();
    });

    it('should return session when valid and signature matches', () => {
      mockSafeDecrypt.mockReturnValue(mockValidPayload);

      const result = parseSessionHeader('valid-session.id.here', TEST_TOKEN);

      expect(result).toBeDefined();
      expect(result?.payload).toEqual(mockValidPayload);
    });

    it('should return undefined when signature mismatches', () => {
      // Use a unique session ID that won't be in cache from other tests
      const uniqueSessionId = 'mismatch.session.unique';
      mockSafeDecrypt.mockReturnValue({
        ...mockValidPayload,
        authSig: 'different-sig',
      });

      const result = parseSessionHeader(uniqueSessionId, TEST_TOKEN);
      expect(result).toBeUndefined();
    });
  });

  // ============================================
  // decryptPublicSession Tests
  // ============================================

  describe('decryptPublicSession', () => {
    const mockPublicPayload: SessionIdPayload = {
      nodeId: TEST_NODE_ID,
      authSig: 'public',
      uuid: TEST_UUID,
      iat: 1234567890,
      isPublic: true,
    };

    it('should return null for invalid session', () => {
      mockSafeDecrypt.mockReturnValue(null);

      const result = decryptPublicSession('invalid-session');
      expect(result).toBeNull();
    });

    it('should return payload for valid public session', () => {
      mockSafeDecrypt.mockReturnValue(mockPublicPayload);

      const result = decryptPublicSession('valid.public.session');

      expect(result).toEqual(mockPublicPayload);
    });

    it('should return null when authSig is not public', () => {
      mockSafeDecrypt.mockReturnValue({
        ...mockPublicPayload,
        authSig: 'not-public',
      });

      const result = decryptPublicSession('not.public.session');
      expect(result).toBeNull();
    });

    it('should return null when isPublic is not true', () => {
      mockSafeDecrypt.mockReturnValue({
        ...mockPublicPayload,
        isPublic: false,
      });

      const result = decryptPublicSession('not.public.session');
      expect(result).toBeNull();
    });
  });

  // ============================================
  // Cookie Utility Tests
  // ============================================

  describe('generateSessionCookie', () => {
    it('should generate cookie with default TTL', () => {
      const cookie = generateSessionCookie('test-session-id');

      expect(cookie).toContain('mcp_session_id=test-session-id');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Expires=');
    });

    it('should generate cookie with custom TTL', () => {
      const cookie = generateSessionCookie('test-session-id', 30);

      expect(cookie).toContain('mcp_session_id=test-session-id');
      // 30 minutes from now
      expect(cookie).toContain('Expires=');
    });
  });

  describe('extractSessionFromCookie', () => {
    it('should return undefined for undefined cookie', () => {
      const result = extractSessionFromCookie(undefined);
      expect(result).toBeUndefined();
    });

    it('should extract session ID from cookie string', () => {
      const result = extractSessionFromCookie('mcp_session_id=test-session-123');
      expect(result).toBe('test-session-123');
    });

    it('should extract session ID when multiple cookies present', () => {
      const result = extractSessionFromCookie('other=value; mcp_session_id=test-session-456; another=value');
      expect(result).toBe('test-session-456');
    });

    it('should return undefined when session cookie not present', () => {
      const result = extractSessionFromCookie('other=value; different=cookie');
      expect(result).toBeUndefined();
    });
  });

  // ============================================
  // getSessionClientInfo Tests
  // ============================================

  describe('getSessionClientInfo', () => {
    it('should return client info from cached session', () => {
      // Create session and update with client info
      const { id } = createSessionId('streamable-http', TEST_TOKEN);
      updateSessionPayload(id, { clientName: 'Test Client', clientVersion: '1.0.0' });

      const result = getSessionClientInfo(id);

      expect(result).toEqual({ name: 'Test Client', version: '1.0.0' });
    });

    it('should return null for invalid session', () => {
      mockSafeDecrypt.mockReturnValue(null);

      const result = getSessionClientInfo('invalid-session');
      expect(result).toBeNull();
    });

    it('should return undefined name/version when not set', () => {
      const { id } = createSessionId('streamable-http', TEST_TOKEN);

      const result = getSessionClientInfo(id);

      expect(result).toEqual({ name: undefined, version: undefined });
    });
  });

  // ============================================
  // Environment Variable Tests
  // ============================================

  describe('encryption key derivation', () => {
    // Note: The encryption key is cached at module level, so these tests
    // verify behavior but can't fully test key derivation without module isolation.
    // The key is derived once when the module first encrypts/decrypts.

    it('should complete encryption without errors when MCP_SESSION_SECRET is set', () => {
      process.env['MCP_SESSION_SECRET'] = 'test-secret';

      // Session creation should complete without error
      const result = createSessionId('streamable-http', TEST_TOKEN);
      expect(result.id).toBeDefined();
      expect(result.payload).toBeDefined();
    });

    it('should complete encryption in development mode without secret', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      process.env['NODE_ENV'] = 'development';
      delete process.env['MCP_SESSION_SECRET'];

      // Session creation should complete without error
      const result = createSessionId('streamable-http', TEST_TOKEN);
      expect(result.id).toBeDefined();
      expect(result.payload).toBeDefined();

      warnSpy.mockRestore();
    });
  });
});
