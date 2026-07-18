import * as dns from 'node:dns';

import {
  CimdClientIdMismatchError,
  CimdFetchError,
  CimdSecurityError,
  CimdValidationError,
  RedirectUriMismatchError,
} from '../cimd.errors';
import type { CimdLogger } from '../cimd.logger';
import { CimdService } from '../cimd.service';
import type { ClientMetadataDocument } from '../cimd.types';

// Mock node:dns so the DNS-aware SSRF guard is hermetic. Default: resolve every
// host to a public address (so existing tests using example.com are allowed);
// individual tests override the resolution to exercise the SSRF block.
jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }));

const mockDnsLookup = dns.promises.lookup as unknown as jest.Mock;

// Mock logger implementing CimdLogger interface
const createMockLogger = (): jest.Mocked<CimdLogger> => ({
  child: jest.fn().mockReturnThis(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

// Sample valid CIMD document
const validCimdDocument: ClientMetadataDocument = {
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
    // Default: hosts resolve to a public address so the SSRF guard allows them.
    mockDnsLookup.mockReset();
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
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

  describe('SSRF (DNS-aware) — attacker-controlled client_id host', () => {
    it('rejects a CIMD client_id whose host resolves to an internal address', async () => {
      // Host is not a literal IP, so the literal checks pass — but it resolves to
      // cloud metadata. The DNS-aware guard must block the fetch (no fetch call).
      mockDnsLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
      await expect(
        service.resolveClientMetadata('https://metadata.attacker.example/oauth/client-metadata.json'),
      ).rejects.toBeInstanceOf(CimdSecurityError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('allows a CIMD client_id whose host resolves to a public address', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: null,
        arrayBuffer: async () =>
          new TextEncoder().encode(
            JSON.stringify({
              client_id: 'https://good.example/oauth/client-metadata.json',
              client_name: 'Good',
              redirect_uris: ['https://good.example/cb'],
            }),
          ).buffer,
      } as unknown as Response);
      const result = await service.resolveClientMetadata('https://good.example/oauth/client-metadata.json');
      expect(result.isCimdClient).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
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
      expect(() => service.validateRedirectUri('https://example.com/callback', validCimdDocument)).not.toThrow();
    });

    it('should throw RedirectUriMismatchError for unregistered URI', () => {
      expect(() => service.validateRedirectUri('https://unregistered.com/callback', validCimdDocument)).toThrow(
        RedirectUriMismatchError,
      );
    });

    it('should normalize URIs for comparison', () => {
      // With trailing slash normalization
      expect(() =>
        service.validateRedirectUri('https://example.com/callback/', {
          ...validCimdDocument,
          redirect_uris: ['https://example.com/callback'],
        } satisfies ClientMetadataDocument),
      ).not.toThrow();
    });

    // #42 — RFC 8252 §7.3: loopback redirects use an ephemeral OS-assigned
    // port, so the port MUST be ignored when matching a loopback redirect_uri.
    describe('loopback redirect_uri (RFC 8252 §7.3)', () => {
      it('should accept a different port on 127.0.0.1 loopback', () => {
        expect(() =>
          service.validateRedirectUri('http://127.0.0.1:54321/callback', {
            ...validCimdDocument,
            redirect_uris: ['http://127.0.0.1:8080/callback'],
          } satisfies ClientMetadataDocument),
        ).not.toThrow();
      });

      it('should accept a different port on localhost loopback', () => {
        expect(() =>
          service.validateRedirectUri('http://localhost:61000/callback', {
            ...validCimdDocument,
            redirect_uris: ['http://localhost:3000/callback'],
          } satisfies ClientMetadataDocument),
        ).not.toThrow();
      });

      it('should accept a different port on [::1] IPv6 loopback', () => {
        expect(() =>
          service.validateRedirectUri('http://[::1]:55555/callback', {
            ...validCimdDocument,
            redirect_uris: ['http://[::1]:9999/callback'],
          } satisfies ClientMetadataDocument),
        ).not.toThrow();
      });

      it('should still reject a loopback redirect with a mismatched path', () => {
        expect(() =>
          service.validateRedirectUri('http://127.0.0.1:54321/evil', {
            ...validCimdDocument,
            redirect_uris: ['http://127.0.0.1:8080/callback'],
          } satisfies ClientMetadataDocument),
        ).toThrow(RedirectUriMismatchError);
      });

      it('should still reject a loopback redirect with a mismatched scheme', () => {
        expect(() =>
          service.validateRedirectUri('https://127.0.0.1:54321/callback', {
            ...validCimdDocument,
            redirect_uris: ['http://127.0.0.1:8080/callback'],
          } satisfies ClientMetadataDocument),
        ).toThrow(RedirectUriMismatchError);
      });

      it('should keep exact (port-sensitive) matching for non-loopback hosts', () => {
        // A public host with a differing port must NOT match.
        expect(() =>
          service.validateRedirectUri('https://example.com:8443/callback', {
            ...validCimdDocument,
            redirect_uris: ['https://example.com/callback'],
          } satisfies ClientMetadataDocument),
        ).toThrow(RedirectUriMismatchError);
      });
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
      expect((await service.getCacheStats()).size).toBe(1);

      await service.clearCache('https://example.com/oauth/client-metadata.json');
      expect((await service.getCacheStats()).size).toBe(0);
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

      await service.clearCache();
      expect((await service.getCacheStats()).size).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      const stats = await service.getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(typeof stats.size).toBe('number');
    });
  });
});
