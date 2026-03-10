import {
  isCimdClientId,
  validateClientIdUrl,
  checkSsrfProtection,
  hasOnlyLocalhostRedirectUris,
} from '../cimd.validator';
import { InvalidClientIdUrlError, CimdSecurityError } from '../cimd.errors';

describe('cimd.validator', () => {
  describe('isCimdClientId', () => {
    it('should return true for HTTPS URL with path', () => {
      expect(isCimdClientId('https://example.com/oauth/client-metadata.json')).toBe(true);
      expect(isCimdClientId('https://example.com/client')).toBe(true);
      expect(isCimdClientId('https://sub.example.com/path/to/metadata')).toBe(true);
    });

    it('should return false for HTTPS URL without path', () => {
      expect(isCimdClientId('https://example.com')).toBe(false);
      expect(isCimdClientId('https://example.com/')).toBe(false);
    });

    it('should return false for HTTP URL', () => {
      expect(isCimdClientId('http://example.com/oauth/client-metadata.json')).toBe(false);
    });

    it('should return false for non-URL strings', () => {
      expect(isCimdClientId('my-client-id')).toBe(false);
      expect(isCimdClientId('123456')).toBe(false);
      expect(isCimdClientId('')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isCimdClientId('not-a-url')).toBe(false);
      expect(isCimdClientId('://invalid')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isCimdClientId(null as unknown as string)).toBe(false);
      expect(isCimdClientId(undefined as unknown as string)).toBe(false);
    });

    describe('allowInsecure flag', () => {
      it('should return false for HTTP URL when allowInsecure is false', () => {
        expect(isCimdClientId('http://localhost/client', false)).toBe(false);
        expect(isCimdClientId('http://127.0.0.1/client', false)).toBe(false);
      });

      it('should return true for HTTP localhost URL when allowInsecure is true', () => {
        expect(isCimdClientId('http://localhost/client', true)).toBe(true);
        expect(isCimdClientId('http://localhost:3000/client-metadata.json', true)).toBe(true);
        expect(isCimdClientId('http://127.0.0.1/client', true)).toBe(true);
        expect(isCimdClientId('http://[::1]/client', true)).toBe(true);
        expect(isCimdClientId('http://sub.localhost/client', true)).toBe(true);
      });

      it('should return false for HTTP non-localhost URL even when allowInsecure is true', () => {
        expect(isCimdClientId('http://example.com/client', true)).toBe(false);
        expect(isCimdClientId('http://10.0.0.1/client', true)).toBe(false);
      });

      it('should still require path component when allowInsecure is true', () => {
        expect(isCimdClientId('http://localhost/', true)).toBe(false);
        expect(isCimdClientId('http://localhost', true)).toBe(false);
      });
    });
  });

  describe('validateClientIdUrl', () => {
    it('should return URL for valid CIMD client_id', () => {
      const url = validateClientIdUrl('https://example.com/oauth/client-metadata.json');
      expect(url).toBeInstanceOf(URL);
      expect(url.hostname).toBe('example.com');
      expect(url.pathname).toBe('/oauth/client-metadata.json');
    });

    it('should throw InvalidClientIdUrlError for HTTP URL', () => {
      expect(() => validateClientIdUrl('http://example.com/client')).toThrow(InvalidClientIdUrlError);
      expect(() => validateClientIdUrl('http://example.com/client')).toThrow(/HTTPS/);
    });

    it('should throw InvalidClientIdUrlError for URL without path', () => {
      expect(() => validateClientIdUrl('https://example.com/')).toThrow(InvalidClientIdUrlError);
      expect(() => validateClientIdUrl('https://example.com')).toThrow(InvalidClientIdUrlError);
    });

    it('should throw InvalidClientIdUrlError for invalid URL', () => {
      expect(() => validateClientIdUrl('not-a-url')).toThrow(InvalidClientIdUrlError);
    });

    it('should throw InvalidClientIdUrlError for empty string', () => {
      expect(() => validateClientIdUrl('')).toThrow(InvalidClientIdUrlError);
    });

    describe('SSRF protection', () => {
      it('should throw CimdSecurityError for localhost', () => {
        expect(() => validateClientIdUrl('https://localhost/client')).toThrow(CimdSecurityError);
        expect(() => validateClientIdUrl('https://localhost.localdomain/client')).toThrow(CimdSecurityError);
      });

      it('should throw CimdSecurityError for loopback IPv4', () => {
        expect(() => validateClientIdUrl('https://127.0.0.1/client')).toThrow(CimdSecurityError);
        expect(() => validateClientIdUrl('https://127.0.1.1/client')).toThrow(CimdSecurityError);
      });

      it('should throw CimdSecurityError for private IPv4 Class A', () => {
        expect(() => validateClientIdUrl('https://10.0.0.1/client')).toThrow(CimdSecurityError);
        expect(() => validateClientIdUrl('https://10.255.255.255/client')).toThrow(CimdSecurityError);
      });

      it('should throw CimdSecurityError for private IPv4 Class B', () => {
        expect(() => validateClientIdUrl('https://172.16.0.1/client')).toThrow(CimdSecurityError);
        expect(() => validateClientIdUrl('https://172.31.255.255/client')).toThrow(CimdSecurityError);
      });

      it('should throw CimdSecurityError for private IPv4 Class C', () => {
        expect(() => validateClientIdUrl('https://192.168.0.1/client')).toThrow(CimdSecurityError);
        expect(() => validateClientIdUrl('https://192.168.255.255/client')).toThrow(CimdSecurityError);
      });

      it('should throw CimdSecurityError for link-local IPv4', () => {
        expect(() => validateClientIdUrl('https://169.254.0.1/client')).toThrow(CimdSecurityError);
      });

      it('should allow SSRF when blockPrivateIPs is false', () => {
        const url = validateClientIdUrl('https://192.168.1.1/client', { blockPrivateIPs: false });
        expect(url.hostname).toBe('192.168.1.1');
      });
    });

    describe('domain allow/block lists', () => {
      it('should allow domains in allowedDomains list', () => {
        const url = validateClientIdUrl('https://trusted.example.com/client', {
          allowedDomains: ['trusted.example.com'],
        });
        expect(url.hostname).toBe('trusted.example.com');
      });

      it('should throw CimdSecurityError for domains not in allowedDomains', () => {
        expect(() =>
          validateClientIdUrl('https://untrusted.com/client', {
            allowedDomains: ['trusted.example.com'],
          }),
        ).toThrow(CimdSecurityError);
      });

      it('should throw CimdSecurityError for blocked domains', () => {
        expect(() =>
          validateClientIdUrl('https://blocked.example.com/client', {
            blockedDomains: ['blocked.example.com'],
          }),
        ).toThrow(CimdSecurityError);
      });

      it('should match subdomains against allowedDomains', () => {
        const url = validateClientIdUrl('https://sub.example.com/client', {
          allowedDomains: ['example.com'],
        });
        expect(url.hostname).toBe('sub.example.com');
      });

      it('should support wildcard domains', () => {
        const url = validateClientIdUrl('https://any.example.com/client', {
          allowedDomains: ['*.example.com'],
        });
        expect(url.hostname).toBe('any.example.com');
      });
    });

    describe('allowInsecureForTesting', () => {
      it('should throw for HTTP localhost when allowInsecureForTesting is false', () => {
        expect(() => validateClientIdUrl('http://localhost/client', { allowInsecureForTesting: false })).toThrow(
          InvalidClientIdUrlError,
        );
        expect(() => validateClientIdUrl('http://localhost/client', { allowInsecureForTesting: false })).toThrow(
          /HTTPS/,
        );
      });

      it('should allow HTTP localhost when allowInsecureForTesting is true', () => {
        const url = validateClientIdUrl('http://localhost/client', {
          allowInsecureForTesting: true,
        });
        expect(url.hostname).toBe('localhost');
        expect(url.protocol).toBe('http:');
      });

      it('should allow HTTP 127.0.0.1 when allowInsecureForTesting is true', () => {
        const url = validateClientIdUrl('http://127.0.0.1/client', {
          allowInsecureForTesting: true,
        });
        expect(url.hostname).toBe('127.0.0.1');
      });

      it('should allow HTTP [::1] when allowInsecureForTesting is true', () => {
        const url = validateClientIdUrl('http://[::1]/client', {
          allowInsecureForTesting: true,
        });
        expect(url.hostname).toBe('[::1]');
      });

      it('should allow HTTP *.localhost when allowInsecureForTesting is true', () => {
        const url = validateClientIdUrl('http://sub.localhost/client', {
          allowInsecureForTesting: true,
        });
        expect(url.hostname).toBe('sub.localhost');
      });

      it('should reject HTTP non-localhost even when allowInsecureForTesting is true', () => {
        expect(() => validateClientIdUrl('http://example.com/client', { allowInsecureForTesting: true })).toThrow(
          InvalidClientIdUrlError,
        );
      });

      it('should bypass SSRF protection for localhost when allowInsecureForTesting is true', () => {
        // Without allowInsecureForTesting, localhost would be blocked by SSRF protection
        expect(() => validateClientIdUrl('https://localhost/client', { blockPrivateIPs: true })).toThrow(
          CimdSecurityError,
        );

        // With allowInsecureForTesting, localhost SSRF protection is bypassed
        const url = validateClientIdUrl('http://localhost/client', {
          allowInsecureForTesting: true,
          blockPrivateIPs: true, // This should be bypassed
        });
        expect(url.hostname).toBe('localhost');
      });

      it('should still require path component when allowInsecureForTesting is true', () => {
        expect(() => validateClientIdUrl('http://localhost/', { allowInsecureForTesting: true })).toThrow(
          InvalidClientIdUrlError,
        );
      });
    });
  });

  describe('checkSsrfProtection', () => {
    it('should allow public hostnames', () => {
      expect(checkSsrfProtection('example.com').allowed).toBe(true);
      expect(checkSsrfProtection('google.com').allowed).toBe(true);
    });

    it('should block localhost', () => {
      expect(checkSsrfProtection('localhost').allowed).toBe(false);
      expect(checkSsrfProtection('LOCALHOST').allowed).toBe(false);
      expect(checkSsrfProtection('sub.localhost').allowed).toBe(false);
    });

    it('should block loopback addresses', () => {
      expect(checkSsrfProtection('127.0.0.1').allowed).toBe(false);
      expect(checkSsrfProtection('127.255.255.255').allowed).toBe(false);
    });

    it('should block private Class A', () => {
      expect(checkSsrfProtection('10.0.0.0').allowed).toBe(false);
      expect(checkSsrfProtection('10.255.255.255').allowed).toBe(false);
    });

    it('should block private Class B', () => {
      expect(checkSsrfProtection('172.16.0.0').allowed).toBe(false);
      expect(checkSsrfProtection('172.31.255.255').allowed).toBe(false);
      // 172.15.x.x and 172.32.x.x should be allowed
      expect(checkSsrfProtection('172.15.0.1').allowed).toBe(true);
      expect(checkSsrfProtection('172.32.0.1').allowed).toBe(true);
    });

    it('should block private Class C', () => {
      expect(checkSsrfProtection('192.168.0.0').allowed).toBe(false);
      expect(checkSsrfProtection('192.168.255.255').allowed).toBe(false);
    });

    it('should block link-local addresses', () => {
      expect(checkSsrfProtection('169.254.0.1').allowed).toBe(false);
      expect(checkSsrfProtection('169.254.255.254').allowed).toBe(false);
    });

    it('should block IPv6 loopback', () => {
      expect(checkSsrfProtection('::1').allowed).toBe(false);
    });

    it('should block IPv6 unique local', () => {
      expect(checkSsrfProtection('fc00::1').allowed).toBe(false);
      expect(checkSsrfProtection('fd00::1').allowed).toBe(false);
    });

    it('should block IPv6 link-local', () => {
      expect(checkSsrfProtection('fe80::1').allowed).toBe(false);
    });

    it('should allow public IPv4', () => {
      expect(checkSsrfProtection('8.8.8.8').allowed).toBe(true);
      expect(checkSsrfProtection('1.1.1.1').allowed).toBe(true);
    });

    it('should block multicast addresses', () => {
      expect(checkSsrfProtection('224.0.0.1').allowed).toBe(false);
      expect(checkSsrfProtection('239.255.255.255').allowed).toBe(false);
    });
  });

  describe('hasOnlyLocalhostRedirectUris', () => {
    it('should return true for localhost-only URIs', () => {
      expect(hasOnlyLocalhostRedirectUris(['http://localhost/callback'])).toBe(true);
      expect(hasOnlyLocalhostRedirectUris(['http://localhost:3000/callback'])).toBe(true);
      expect(hasOnlyLocalhostRedirectUris(['http://127.0.0.1/callback'])).toBe(true);
      expect(hasOnlyLocalhostRedirectUris(['http://[::1]/callback'])).toBe(true);
    });

    it('should return false for mixed URIs', () => {
      expect(hasOnlyLocalhostRedirectUris(['http://localhost/callback', 'https://example.com/callback'])).toBe(false);
    });

    it('should return false for public URIs', () => {
      expect(hasOnlyLocalhostRedirectUris(['https://example.com/callback'])).toBe(false);
    });

    it('should return false for empty array', () => {
      expect(hasOnlyLocalhostRedirectUris([])).toBe(false);
    });

    it('should handle subdomain localhost', () => {
      expect(hasOnlyLocalhostRedirectUris(['http://sub.localhost/callback'])).toBe(true);
    });
  });
});
