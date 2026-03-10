/**
 * Credential Helpers Tests
 *
 * Tests for the extractCredentialExpiry utility function
 * that extracts expiry timestamps from various credential types.
 */

import { extractCredentialExpiry } from '../credential-helpers';
import type { Credential } from '../../session';

describe('extractCredentialExpiry', () => {
  // --------------------------------------------------
  // OAuth credential
  // --------------------------------------------------

  describe('oauth credential', () => {
    it('should return expiresAt when present', () => {
      const credential: Credential = {
        type: 'oauth',
        accessToken: 'access-tok-123',
        tokenType: 'Bearer',
        scopes: [],
        expiresAt: 1700000000,
      };
      expect(extractCredentialExpiry(credential)).toBe(1700000000);
    });

    it('should return undefined when expiresAt is not set', () => {
      const credential: Credential = {
        type: 'oauth',
        accessToken: 'access-tok-123',
        tokenType: 'Bearer',
        scopes: [],
      };
      expect(extractCredentialExpiry(credential)).toBeUndefined();
    });
  });

  // --------------------------------------------------
  // OAuth PKCE credential
  // --------------------------------------------------

  describe('oauth_pkce credential', () => {
    it('should return expiresAt when present', () => {
      const credential: Credential = {
        type: 'oauth_pkce',
        accessToken: 'pkce-tok-456',
        tokenType: 'Bearer',
        scopes: [],
        expiresAt: 1700001000,
      };
      expect(extractCredentialExpiry(credential)).toBe(1700001000);
    });

    it('should return undefined when expiresAt is not set', () => {
      const credential: Credential = {
        type: 'oauth_pkce',
        accessToken: 'pkce-tok-456',
        tokenType: 'Bearer',
        scopes: [],
      };
      expect(extractCredentialExpiry(credential)).toBeUndefined();
    });
  });

  // --------------------------------------------------
  // Bearer credential
  // --------------------------------------------------

  describe('bearer credential', () => {
    it('should return expiresAt when present', () => {
      const credential: Credential = {
        type: 'bearer',
        token: 'bearer-tok-789',
        expiresAt: 1700002000,
      };
      expect(extractCredentialExpiry(credential)).toBe(1700002000);
    });

    it('should return undefined when expiresAt is not set', () => {
      const credential: Credential = {
        type: 'bearer',
        token: 'bearer-tok-789',
      };
      expect(extractCredentialExpiry(credential)).toBeUndefined();
    });
  });

  // --------------------------------------------------
  // Service Account credential
  // --------------------------------------------------

  describe('service_account credential', () => {
    it('should return expiresAt when present', () => {
      const credential: Credential = {
        type: 'service_account',
        provider: 'gcp',
        credentials: { key: 'value' },
        expiresAt: 1700003000,
      };
      expect(extractCredentialExpiry(credential)).toBe(1700003000);
    });

    it('should return undefined when expiresAt is not set', () => {
      const credential: Credential = {
        type: 'service_account',
        provider: 'aws',
        credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE' },
      };
      expect(extractCredentialExpiry(credential)).toBeUndefined();
    });
  });

  // --------------------------------------------------
  // Credential types without expiry
  // --------------------------------------------------

  describe('credential types without expiry', () => {
    it('should return undefined for api_key credential', () => {
      const credential: Credential = {
        type: 'api_key',
        key: 'sk-test-key-123',
        headerName: 'X-API-Key',
      };
      expect(extractCredentialExpiry(credential)).toBeUndefined();
    });

    it('should return undefined for basic credential', () => {
      const credential: Credential = {
        type: 'basic',
        username: 'user',
        password: 'pass',
      };
      expect(extractCredentialExpiry(credential)).toBeUndefined();
    });

    it('should return undefined for private_key credential', () => {
      const credential: Credential = {
        type: 'private_key',
        format: 'pem',
        keyData: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        algorithm: 'RS256',
      };
      expect(extractCredentialExpiry(credential)).toBeUndefined();
    });

    it('should return undefined for custom credential', () => {
      const credential: Credential = {
        type: 'custom',
        customType: 'my-custom-type',
        data: { foo: 'bar' },
      };
      expect(extractCredentialExpiry(credential)).toBeUndefined();
    });

    it('should return undefined for ssh_key credential', () => {
      const credential: Credential = {
        type: 'ssh_key',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
        keyType: 'ed25519',
      };
      expect(extractCredentialExpiry(credential)).toBeUndefined();
    });

    it('should return undefined for mtls credential', () => {
      const credential: Credential = {
        type: 'mtls',
        certificate: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
        privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
      };
      expect(extractCredentialExpiry(credential)).toBeUndefined();
    });
  });
});
