import {
  getEnv,
  getCwd,
  isProduction,
  isDevelopment,
  getEnvFlag,
  isDebug,
  setEnv,
  isEdgeRuntime,
  isServerless,
  supportsAnsi,
} from '../browser-env';

describe('Browser env polyfill', () => {
  describe('getEnv', () => {
    it('should return undefined for any key', () => {
      expect(getEnv('NODE_ENV')).toBeUndefined();
      expect(getEnv('HOME')).toBeUndefined();
      expect(getEnv('ANYTHING')).toBeUndefined();
    });

    it('should return default value when provided', () => {
      expect(getEnv('NODE_ENV', 'fallback')).toBe('fallback');
      expect(getEnv('MISSING', 'default')).toBe('default');
    });
  });

  describe('getCwd', () => {
    it('should return root path', () => {
      expect(getCwd()).toBe('/');
    });
  });

  describe('isProduction', () => {
    it('should return false', () => {
      expect(isProduction()).toBe(false);
    });
  });

  describe('isDevelopment', () => {
    it('should return false', () => {
      expect(isDevelopment()).toBe(false);
    });
  });

  describe('getEnvFlag', () => {
    it('should return false for any key', () => {
      expect(getEnvFlag('DEBUG')).toBe(false);
      expect(getEnvFlag('FRONTMCP_PERF')).toBe(false);
    });
  });

  describe('isDebug', () => {
    it('should return false', () => {
      expect(isDebug()).toBe(false);
    });
  });

  describe('setEnv', () => {
    it('should be a no-op', () => {
      expect(() => setEnv('KEY', 'value')).not.toThrow();
    });
  });

  describe('isEdgeRuntime', () => {
    it('should return false', () => {
      expect(isEdgeRuntime()).toBe(false);
    });
  });

  describe('isServerless', () => {
    it('should return false', () => {
      expect(isServerless()).toBe(false);
    });
  });

  describe('supportsAnsi', () => {
    it('should return false', () => {
      expect(supportsAnsi()).toBe(false);
    });
  });
});
