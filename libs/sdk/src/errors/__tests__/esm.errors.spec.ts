import {
  EsmPackageLoadError,
  EsmVersionResolutionError,
  EsmManifestInvalidError,
  EsmCacheError,
  EsmRegistryAuthError,
  EsmInvalidSpecifierError,
} from '../esm.errors';
import { InternalMcpError, PublicMcpError, MCP_ERROR_CODES } from '../mcp.error';

describe('ESM Error Classes', () => {
  describe('EsmPackageLoadError', () => {
    it('should be an InternalMcpError', () => {
      const error = new EsmPackageLoadError('pkg', '1.0.0');
      expect(error).toBeInstanceOf(InternalMcpError);
      expect(error.packageName).toBe('pkg');
      expect(error.version).toBe('1.0.0');
    });

    it('should include original error message', () => {
      const original = new Error('fetch failed');
      const error = new EsmPackageLoadError('pkg', '1.0.0', original);
      expect(error.message).toContain('fetch failed');
      expect(error.originalError).toBe(original);
    });

    it('should handle missing version', () => {
      const error = new EsmPackageLoadError('pkg');
      expect(error.message).toContain('"pkg"');
      expect(error.version).toBeUndefined();
    });
  });

  describe('EsmVersionResolutionError', () => {
    it('should be an InternalMcpError', () => {
      const error = new EsmVersionResolutionError('pkg', '^1.0.0');
      expect(error).toBeInstanceOf(InternalMcpError);
      expect(error.packageName).toBe('pkg');
      expect(error.range).toBe('^1.0.0');
    });

    it('should include original error', () => {
      const original = new Error('timeout');
      const error = new EsmVersionResolutionError('pkg', '^1.0.0', original);
      expect(error.originalError).toBe(original);
      expect(error.message).toContain('timeout');
    });
  });

  describe('EsmManifestInvalidError', () => {
    it('should be a PublicMcpError', () => {
      const error = new EsmManifestInvalidError('pkg');
      expect(error).toBeInstanceOf(PublicMcpError);
      expect(error.packageName).toBe('pkg');
      expect(error.mcpErrorCode).toBe(MCP_ERROR_CODES.INVALID_PARAMS);
    });

    it('should include details', () => {
      const error = new EsmManifestInvalidError('pkg', 'missing name field');
      expect(error.details).toBe('missing name field');
      expect(error.message).toContain('missing name field');
    });
  });

  describe('EsmCacheError', () => {
    it('should be an InternalMcpError', () => {
      const error = new EsmCacheError('read');
      expect(error).toBeInstanceOf(InternalMcpError);
      expect(error.operation).toBe('read');
    });

    it('should include package name and original error', () => {
      const original = new Error('ENOENT');
      const error = new EsmCacheError('read', 'pkg', original);
      expect(error.packageName).toBe('pkg');
      expect(error.originalError).toBe(original);
    });
  });

  describe('EsmRegistryAuthError', () => {
    it('should be a PublicMcpError with UNAUTHORIZED code', () => {
      const error = new EsmRegistryAuthError();
      expect(error).toBeInstanceOf(PublicMcpError);
      expect(error.mcpErrorCode).toBe(MCP_ERROR_CODES.UNAUTHORIZED);
    });

    it('should include registry URL', () => {
      const error = new EsmRegistryAuthError('https://npm.pkg.github.com', 'invalid token');
      expect(error.registryUrl).toBe('https://npm.pkg.github.com');
      expect(error.details).toBe('invalid token');
    });
  });

  describe('EsmInvalidSpecifierError', () => {
    it('should be a PublicMcpError', () => {
      const error = new EsmInvalidSpecifierError('invalid!!!');
      expect(error).toBeInstanceOf(PublicMcpError);
      expect(error.specifier).toBe('invalid!!!');
      expect(error.mcpErrorCode).toBe(MCP_ERROR_CODES.INVALID_PARAMS);
    });
  });
});
