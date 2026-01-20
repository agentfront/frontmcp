import { CimdService } from '../cimd.service';
import {
  CimdFetchError,
  CimdValidationError,
  CimdClientIdMismatchError,
  RedirectUriMismatchError,
} from '../cimd.errors';
import type { CimdLogger } from '../cimd.logger';

// Mock logger implementing CimdLogger interface
const createMockLogger = (): jest.Mocked<CimdLogger> => ({
  child: jest.fn().mockReturnThis(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

// Sample valid CIMD document
const validCimdDocument = {
  client_id: 'https://example.com/oauth/client-metadata.json',
  client_name: 'Test Client',
  redirect_uris: ['https://example.com/callback', 'http://localhost:3000/callback'],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code'],
  response_types: ['code'],
};

describe('CimdService', () => {
  let service: CimdService;
  let mockLogger: jest.Mocked<CimdLogger>;
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    mockLogger = createMockLogger();
    service = new CimdService(mockLogger);
    mockFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    mockFetch.mockRestore();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      expect(service.enabled).toBe(true);
    });

    it('should respect enabled=false config', () => {
      const disabledService = new CimdService(mockLogger, { enabled: false });
      expect(disabledService.enabled).toBe(false);
    });

    it('should log warning when allowInsecureForTesting is enabled', () => {
      const logger = createMockLogger();
      new CimdService(logger, {
        security: { allowInsecureForTesting: true },
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('allowInsecureForTesting'));
    });

    it('should not log warning when allowInsecureForTesting is disabled', () => {
      const logger = createMockLogger();
      new CimdService(logger, {
        security: { allowInsecureForTesting: false },
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should work without a logger (use noopLogger)', () => {
      const noLoggerService = new CimdService(undefined);
      expect(noLoggerService.enabled).toBe(true);
    });
  });

  describe('isCimdClientId', () => {
    it('should identify CIMD client IDs', () => {
      expect(service.isCimdClientId('https://example.com/oauth/client')).toBe(true);
    });

    it('should reject non-CIMD client IDs', () => {
      expect(service.isCimdClientId('my-client-id')).toBe(false);
      expect(service.isCimdClientId('https://example.com')).toBe(false);
    });

    it('should reject HTTP localhost when allowInsecureForTesting is false (default)', () => {
      expect(service.isCimdClientId('http://localhost/client')).toBe(false);
    });

    it('should accept HTTP localhost when allowInsecureForTesting is true', () => {
      const testingService = new CimdService(mockLogger, {
        security: { allowInsecureForTesting: true },
      });
      expect(testingService.isCimdClientId('http://localhost/client')).toBe(true);
      expect(testingService.isCimdClientId('http://127.0.0.1/client')).toBe(true);
    });
  });

  describe('resolveClientMetadata', () => {
    it('should return isCimdClient=false for non-CIMD client IDs', async () => {
      const result = await service.resolveClientMetadata('regular-client-id');
      expect(result.isCimdClient).toBe(false);
      expect(result.metadata).toBeUndefined();
    });

    it('should fetch and return metadata for CIMD client ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'cache-control': 'max-age=3600',
        }),
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(JSON.stringify(validCimdDocument)),
              })
              .mockResolvedValueOnce({ done: true }),
            releaseLock: jest.fn(),
          }),
        },
      });

      const result = await service.resolveClientMetadata('https://example.com/oauth/client-metadata.json');

      expect(result.isCimdClient).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.client_name).toBe('Test Client');
      expect(result.fromCache).toBe(false);
    });

    it('should return cached result on second call', async () => {
      // First call - fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'cache-control': 'max-age=3600',
        }),
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(JSON.stringify(validCimdDocument)),
              })
              .mockResolvedValueOnce({ done: true }),
            releaseLock: jest.fn(),
          }),
        },
      });

      await service.resolveClientMetadata('https://example.com/oauth/client-metadata.json');

      // Second call - should use cache
      const result = await service.resolveClientMetadata('https://example.com/oauth/client-metadata.json');

      expect(result.fromCache).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw CimdFetchError on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.resolveClientMetadata('https://example.com/oauth/client-metadata.json')).rejects.toThrow(
        CimdFetchError,
      );
    });

    it('should throw CimdFetchError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
      });

      await expect(service.resolveClientMetadata('https://example.com/oauth/client-metadata.json')).rejects.toThrow(
        CimdFetchError,
      );
    });

    it('should throw CimdValidationError for invalid document', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(
                  JSON.stringify({
                    client_id: 'https://example.com/oauth/client-metadata.json',
                    // Missing required fields
                  }),
                ),
              })
              .mockResolvedValueOnce({ done: true }),
            releaseLock: jest.fn(),
          }),
        },
      });

      await expect(service.resolveClientMetadata('https://example.com/oauth/client-metadata.json')).rejects.toThrow(
        CimdValidationError,
      );
    });

    it('should throw CimdClientIdMismatchError when client_id does not match URL', async () => {
      const mismatchedDocument = {
        ...validCimdDocument,
        client_id: 'https://different.com/client',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(JSON.stringify(mismatchedDocument)),
              })
              .mockResolvedValueOnce({ done: true }),
            releaseLock: jest.fn(),
          }),
        },
      });

      await expect(service.resolveClientMetadata('https://example.com/oauth/client-metadata.json')).rejects.toThrow(
        CimdClientIdMismatchError,
      );
    });
  });

  describe('validateRedirectUri', () => {
    it('should pass for registered redirect URI', () => {
      expect(() => service.validateRedirectUri('https://example.com/callback', validCimdDocument as any)).not.toThrow();
    });

    it('should throw RedirectUriMismatchError for unregistered URI', () => {
      expect(() => service.validateRedirectUri('https://unregistered.com/callback', validCimdDocument as any)).toThrow(
        RedirectUriMismatchError,
      );
    });

    it('should normalize URIs for comparison', () => {
      // With trailing slash normalization
      expect(() =>
        service.validateRedirectUri('https://example.com/callback/', {
          ...validCimdDocument,
          redirect_uris: ['https://example.com/callback'],
        } as any),
      ).not.toThrow();
    });
  });

  describe('clearCache', () => {
    it('should clear specific client cache', async () => {
      // First populate the cache
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'cache-control': 'max-age=3600' }),
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(JSON.stringify(validCimdDocument)),
              })
              .mockResolvedValueOnce({ done: true }),
            releaseLock: jest.fn(),
          }),
        },
      });

      await service.resolveClientMetadata('https://example.com/oauth/client-metadata.json');
      expect(service.getCacheStats().size).toBe(1);

      service.clearCache('https://example.com/oauth/client-metadata.json');
      expect(service.getCacheStats().size).toBe(0);
    });

    it('should clear all cache', async () => {
      // Populate cache
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'cache-control': 'max-age=3600' }),
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(JSON.stringify(validCimdDocument)),
              })
              .mockResolvedValueOnce({ done: true }),
            releaseLock: jest.fn(),
          }),
        },
      });

      await service.resolveClientMetadata('https://example.com/oauth/client-metadata.json');

      service.clearCache();
      expect(service.getCacheStats().size).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = service.getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(typeof stats.size).toBe('number');
    });
  });
});
