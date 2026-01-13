/**
 * Index barrel export tests
 *
 * Verifies all exports are properly accessible from the main entry point.
 */
import * as AuthLib from '../index';

describe('@frontmcp/auth exports', () => {
  describe('JWKS Module exports', () => {
    it('should export JwksService class', () => {
      expect(AuthLib.JwksService).toBeDefined();
      expect(typeof AuthLib.JwksService).toBe('function');
    });

    it('should export trimSlash function', () => {
      expect(AuthLib.trimSlash).toBeDefined();
      expect(typeof AuthLib.trimSlash).toBe('function');
      expect(AuthLib.trimSlash('test/')).toBe('test');
    });

    it('should export normalizeIssuer function', () => {
      expect(AuthLib.normalizeIssuer).toBeDefined();
      expect(typeof AuthLib.normalizeIssuer).toBe('function');
      expect(AuthLib.normalizeIssuer('https://example.com/')).toBe('https://example.com');
    });

    it('should export decodeJwtPayloadSafe function', () => {
      expect(AuthLib.decodeJwtPayloadSafe).toBeDefined();
      expect(typeof AuthLib.decodeJwtPayloadSafe).toBe('function');
    });

    it('should export isDevKeyPersistenceEnabled function', () => {
      expect(AuthLib.isDevKeyPersistenceEnabled).toBeDefined();
      expect(typeof AuthLib.isDevKeyPersistenceEnabled).toBe('function');
    });

    it('should export resolveKeyPath function', () => {
      expect(AuthLib.resolveKeyPath).toBeDefined();
      expect(typeof AuthLib.resolveKeyPath).toBe('function');
    });

    it('should export loadDevKey function', () => {
      expect(AuthLib.loadDevKey).toBeDefined();
      expect(typeof AuthLib.loadDevKey).toBe('function');
    });

    it('should export saveDevKey function', () => {
      expect(AuthLib.saveDevKey).toBeDefined();
      expect(typeof AuthLib.saveDevKey).toBe('function');
    });

    it('should export deleteDevKey function', () => {
      expect(AuthLib.deleteDevKey).toBeDefined();
      expect(typeof AuthLib.deleteDevKey).toBe('function');
    });
  });

  describe('UI Module exports', () => {
    it('should export CDN configuration', () => {
      expect(AuthLib.CDN).toBeDefined();
      expect(AuthLib.CDN.tailwind).toBeDefined();
      expect(AuthLib.CDN.fonts).toBeDefined();
    });

    it('should export DEFAULT_THEME', () => {
      expect(AuthLib.DEFAULT_THEME).toBeDefined();
      expect(AuthLib.DEFAULT_THEME.colors).toBeDefined();
    });

    it('should export baseLayout function', () => {
      expect(AuthLib.baseLayout).toBeDefined();
      expect(typeof AuthLib.baseLayout).toBe('function');
    });

    it('should export createLayout function', () => {
      expect(AuthLib.createLayout).toBeDefined();
      expect(typeof AuthLib.createLayout).toBe('function');
    });

    it('should export authLayout function', () => {
      expect(AuthLib.authLayout).toBeDefined();
      expect(typeof AuthLib.authLayout).toBe('function');
    });

    it('should export centeredCardLayout function', () => {
      expect(AuthLib.centeredCardLayout).toBeDefined();
      expect(typeof AuthLib.centeredCardLayout).toBe('function');
    });

    it('should export wideLayout function', () => {
      expect(AuthLib.wideLayout).toBeDefined();
      expect(typeof AuthLib.wideLayout).toBe('function');
    });

    it('should export extraWideLayout function', () => {
      expect(AuthLib.extraWideLayout).toBeDefined();
      expect(typeof AuthLib.extraWideLayout).toBe('function');
    });

    it('should export escapeHtml function', () => {
      expect(AuthLib.escapeHtml).toBeDefined();
      expect(typeof AuthLib.escapeHtml).toBe('function');
    });

    it('should export buildConsentPage function', () => {
      expect(AuthLib.buildConsentPage).toBeDefined();
      expect(typeof AuthLib.buildConsentPage).toBe('function');
    });

    it('should export buildIncrementalAuthPage function', () => {
      expect(AuthLib.buildIncrementalAuthPage).toBeDefined();
      expect(typeof AuthLib.buildIncrementalAuthPage).toBe('function');
    });

    it('should export buildFederatedLoginPage function', () => {
      expect(AuthLib.buildFederatedLoginPage).toBeDefined();
      expect(typeof AuthLib.buildFederatedLoginPage).toBe('function');
    });

    it('should export buildToolConsentPage function', () => {
      expect(AuthLib.buildToolConsentPage).toBeDefined();
      expect(typeof AuthLib.buildToolConsentPage).toBe('function');
    });

    it('should export buildLoginPage function', () => {
      expect(AuthLib.buildLoginPage).toBeDefined();
      expect(typeof AuthLib.buildLoginPage).toBe('function');
    });

    it('should export buildErrorPage function', () => {
      expect(AuthLib.buildErrorPage).toBeDefined();
      expect(typeof AuthLib.buildErrorPage).toBe('function');
    });

    it('should export renderToHtml function', () => {
      expect(AuthLib.renderToHtml).toBeDefined();
      expect(typeof AuthLib.renderToHtml).toBe('function');
    });
  });

  describe('Storage Module exports', () => {
    it('should export TypedStorage class', () => {
      expect(AuthLib.TypedStorage).toBeDefined();
      expect(typeof AuthLib.TypedStorage).toBe('function');
    });

    it('should export EncryptedTypedStorage class', () => {
      expect(AuthLib.EncryptedTypedStorage).toBeDefined();
      expect(typeof AuthLib.EncryptedTypedStorage).toBe('function');
    });

    it('should export EncryptedStorageError class', () => {
      expect(AuthLib.EncryptedStorageError).toBeDefined();
      expect(typeof AuthLib.EncryptedStorageError).toBe('function');
    });

    it('should export StorageTokenStore class', () => {
      expect(AuthLib.StorageTokenStore).toBeDefined();
      expect(typeof AuthLib.StorageTokenStore).toBe('function');
    });

    it('should export StorageAuthorizationVault class', () => {
      expect(AuthLib.StorageAuthorizationVault).toBeDefined();
      expect(typeof AuthLib.StorageAuthorizationVault).toBe('function');
    });
  });

  describe('integration', () => {
    it('should create JwksService instance', () => {
      const service = new AuthLib.JwksService();
      expect(service).toBeInstanceOf(AuthLib.JwksService);
    });

    it('should build a complete auth page', () => {
      const html = AuthLib.buildLoginPage({
        clientName: 'Test',
        scope: 'openid',
        pendingAuthId: 'test-123',
        callbackPath: '/callback',
      });
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Test');
    });

    it('should use baseLayout with theme', () => {
      const html = AuthLib.baseLayout('<div>Test</div>', {
        title: 'Test Page',
        theme: {
          colors: { primary: '#ff0000' },
        },
      });
      expect(html).toContain('--color-primary: #ff0000');
    });
  });
});
