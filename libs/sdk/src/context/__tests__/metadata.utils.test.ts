/**
 * Unit tests for metadata extraction utilities
 */

import { extractMetadata, extractClientIp } from '../metadata.utils';

describe('extractMetadata', () => {
  describe('standard headers', () => {
    it('should extract user-agent header', () => {
      const headers = { 'user-agent': 'Mozilla/5.0 Chrome/120.0' };

      const metadata = extractMetadata(headers);

      expect(metadata.userAgent).toBe('Mozilla/5.0 Chrome/120.0');
    });

    it('should extract content-type header', () => {
      const headers = { 'content-type': 'application/json' };

      const metadata = extractMetadata(headers);

      expect(metadata.contentType).toBe('application/json');
    });

    it('should extract accept header', () => {
      const headers = { accept: 'application/json, text/plain' };

      const metadata = extractMetadata(headers);

      expect(metadata.accept).toBe('application/json, text/plain');
    });

    it('should return undefined for missing standard headers', () => {
      const headers = {};

      const metadata = extractMetadata(headers);

      expect(metadata.userAgent).toBeUndefined();
      expect(metadata.contentType).toBeUndefined();
      expect(metadata.accept).toBeUndefined();
    });

    it('should ignore non-string header values', () => {
      const headers = {
        'user-agent': 123 as any,
        'content-type': null as any,
        accept: undefined as any,
      };

      const metadata = extractMetadata(headers);

      expect(metadata.userAgent).toBeUndefined();
      expect(metadata.contentType).toBeUndefined();
      expect(metadata.accept).toBeUndefined();
    });
  });

  describe('custom headers (x-frontmcp-*)', () => {
    it('should extract x-frontmcp-* headers', () => {
      const headers = {
        'x-frontmcp-tenant': 'tenant-123',
        'x-frontmcp-org': 'org-456',
        'x-frontmcp-user': 'user-789',
      };

      const metadata = extractMetadata(headers);

      expect(metadata.customHeaders['x-frontmcp-tenant']).toBe('tenant-123');
      expect(metadata.customHeaders['x-frontmcp-org']).toBe('org-456');
      expect(metadata.customHeaders['x-frontmcp-user']).toBe('user-789');
    });

    it('should normalize custom header keys to lowercase', () => {
      const headers = {
        'X-FrontMCP-Tenant': 'tenant-123',
        'X-FRONTMCP-ORG': 'org-456',
      };

      const metadata = extractMetadata(headers);

      expect(metadata.customHeaders['x-frontmcp-tenant']).toBe('tenant-123');
      expect(metadata.customHeaders['x-frontmcp-org']).toBe('org-456');
    });

    it('should ignore non-string custom header values', () => {
      const headers = {
        'x-frontmcp-valid': 'valid-value',
        'x-frontmcp-invalid': 123 as any,
        'x-frontmcp-null': null as any,
      };

      const metadata = extractMetadata(headers);

      expect(metadata.customHeaders['x-frontmcp-valid']).toBe('valid-value');
      expect(metadata.customHeaders['x-frontmcp-invalid']).toBeUndefined();
      expect(metadata.customHeaders['x-frontmcp-null']).toBeUndefined();
    });

    it('should return empty customHeaders when none present', () => {
      const headers = {
        'user-agent': 'Test',
        'x-custom-header': 'value', // Not x-frontmcp-*
      };

      const metadata = extractMetadata(headers);

      expect(metadata.customHeaders).toEqual({});
    });

    it('should not include non-frontmcp x-* headers', () => {
      const headers = {
        'x-request-id': '123',
        'x-correlation-id': '456',
        'x-frontmcp-tenant': 'tenant',
      };

      const metadata = extractMetadata(headers);

      expect(metadata.customHeaders['x-request-id']).toBeUndefined();
      expect(metadata.customHeaders['x-correlation-id']).toBeUndefined();
      expect(metadata.customHeaders['x-frontmcp-tenant']).toBe('tenant');
    });
  });

  describe('client IP extraction', () => {
    it('should extract client IP from headers', () => {
      const headers = {
        'x-forwarded-for': '192.168.1.100',
      };

      const metadata = extractMetadata(headers);

      expect(metadata.clientIp).toBe('192.168.1.100');
    });

    it('should return undefined clientIp when not present', () => {
      const headers = {};

      const metadata = extractMetadata(headers);

      expect(metadata.clientIp).toBeUndefined();
    });
  });

  describe('combined extraction', () => {
    it('should extract all metadata from complete headers', () => {
      const headers = {
        'user-agent': 'TestClient/2.0',
        'content-type': 'application/json',
        accept: 'application/json',
        'x-forwarded-for': '10.0.0.1, 192.168.1.1',
        'x-frontmcp-tenant': 'acme-corp',
        'x-frontmcp-environment': 'production',
      };

      const metadata = extractMetadata(headers);

      expect(metadata.userAgent).toBe('TestClient/2.0');
      expect(metadata.contentType).toBe('application/json');
      expect(metadata.accept).toBe('application/json');
      expect(metadata.clientIp).toBe('10.0.0.1');
      expect(metadata.customHeaders).toEqual({
        'x-frontmcp-tenant': 'acme-corp',
        'x-frontmcp-environment': 'production',
      });
    });
  });
});

describe('extractClientIp', () => {
  describe('x-forwarded-for header', () => {
    it('should extract single IP', () => {
      const headers = { 'x-forwarded-for': '192.168.1.100' };

      expect(extractClientIp(headers)).toBe('192.168.1.100');
    });

    it('should extract first IP from comma-separated list', () => {
      const headers = { 'x-forwarded-for': '192.168.1.100, 10.0.0.1, 172.16.0.1' };

      expect(extractClientIp(headers)).toBe('192.168.1.100');
    });

    it('should trim whitespace around IP', () => {
      const headers = { 'x-forwarded-for': '  192.168.1.100  ,  10.0.0.1  ' };

      expect(extractClientIp(headers)).toBe('192.168.1.100');
    });

    it('should handle array header value (some adapters)', () => {
      const headers = { 'x-forwarded-for': ['192.168.1.100, 10.0.0.1'] };

      expect(extractClientIp(headers)).toBe('192.168.1.100');
    });

    it('should return undefined for empty array', () => {
      const headers = { 'x-forwarded-for': [] };

      expect(extractClientIp(headers)).toBeUndefined();
    });

    it('should return undefined for non-string array elements', () => {
      const headers = { 'x-forwarded-for': [123 as any] };

      expect(extractClientIp(headers)).toBeUndefined();
    });
  });

  describe('x-real-ip header', () => {
    it('should extract IP from x-real-ip when x-forwarded-for not present', () => {
      const headers = { 'x-real-ip': '192.168.1.200' };

      expect(extractClientIp(headers)).toBe('192.168.1.200');
    });

    it('should prefer x-forwarded-for over x-real-ip', () => {
      const headers = {
        'x-forwarded-for': '192.168.1.100',
        'x-real-ip': '192.168.1.200',
      };

      expect(extractClientIp(headers)).toBe('192.168.1.100');
    });

    it('should handle array value for x-real-ip', () => {
      const headers = { 'x-real-ip': ['192.168.1.200'] };

      expect(extractClientIp(headers)).toBe('192.168.1.200');
    });

    it('should return undefined for non-string x-real-ip', () => {
      const headers = { 'x-real-ip': 123 as any };

      expect(extractClientIp(headers)).toBeUndefined();
    });
  });

  describe('fallback behavior', () => {
    it('should return undefined when no IP headers present', () => {
      const headers = {
        'user-agent': 'Test',
        'content-type': 'application/json',
      };

      expect(extractClientIp(headers)).toBeUndefined();
    });

    it('should return undefined for empty headers', () => {
      expect(extractClientIp({})).toBeUndefined();
    });

    it('should fallback to x-real-ip when x-forwarded-for is non-string', () => {
      const headers = {
        'x-forwarded-for': 123 as any,
        'x-real-ip': '192.168.1.200',
      };

      expect(extractClientIp(headers)).toBe('192.168.1.200');
    });
  });

  describe('IPv6 addresses', () => {
    it('should extract IPv6 address', () => {
      const headers = { 'x-forwarded-for': '2001:db8::1' };

      expect(extractClientIp(headers)).toBe('2001:db8::1');
    });

    it('should extract first IPv6 from list', () => {
      const headers = { 'x-forwarded-for': '2001:db8::1, 2001:db8::2' };

      expect(extractClientIp(headers)).toBe('2001:db8::1');
    });
  });
});
