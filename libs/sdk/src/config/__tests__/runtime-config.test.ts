// file: libs/sdk/src/config/__tests__/runtime-config.test.ts
import {
  initializeConfig,
  getConfig,
  getConfigValue,
  isConfigInitialized,
  resetConfig,
  isNodeEnvironment,
  RuntimeConfig,
} from '../runtime-config';

describe('Runtime Config', () => {
  // Reset config before each test to ensure clean state
  beforeEach(() => {
    resetConfig();
  });

  afterAll(() => {
    resetConfig();
  });

  describe('initializeConfig', () => {
    it('should initialize with provided values', () => {
      initializeConfig({
        debug: true,
        isDevelopment: true,
        machineId: 'test-machine-123',
        sessionSecret: 'test-secret',
        jwtSecret: 'jwt-secret',
      });

      const config = getConfig();
      expect(config.debug).toBe(true);
      expect(config.isDevelopment).toBe(true);
      expect(config.machineId).toBe('test-machine-123');
      expect(config.sessionSecret).toBe('test-secret');
      expect(config.jwtSecret).toBe('jwt-secret');
    });

    it('should use defaults for missing values', () => {
      initializeConfig({});

      const config = getConfig();
      expect(config.debug).toBe(false);
      expect(config.isDevelopment).toBe(false);
      expect(config.machineId).toBeDefined();
      expect(config.machineId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(config.sessionSecret).toBeUndefined();
      expect(config.jwtSecret).toBeUndefined();
    });

    it('should generate unique machineId if not provided', () => {
      initializeConfig({});
      const config1 = getConfig();

      resetConfig();
      initializeConfig({});
      const config2 = getConfig();

      expect(config1.machineId).not.toBe(config2.machineId);
    });

    it('should override previous configuration', () => {
      initializeConfig({ debug: true });
      expect(getConfig().debug).toBe(true);

      initializeConfig({ debug: false });
      expect(getConfig().debug).toBe(false);
    });
  });

  describe('isConfigInitialized', () => {
    it('should return false when not initialized', () => {
      expect(isConfigInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
      initializeConfig({});
      expect(isConfigInitialized()).toBe(true);
    });

    it('should return false after reset', () => {
      initializeConfig({});
      resetConfig();
      expect(isConfigInitialized()).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should return initialized config', () => {
      initializeConfig({ debug: true });
      const config = getConfig();
      expect(config.debug).toBe(true);
    });

    it('should fallback to process.env in Node.js when not initialized', () => {
      // In Node.js, this should work without initialization
      const config = getConfig();
      expect(config).toBeDefined();
      expect(typeof config.debug).toBe('boolean');
      expect(typeof config.isDevelopment).toBe('boolean');
      expect(typeof config.machineId).toBe('string');
    });

    it('should return same object on multiple calls', () => {
      initializeConfig({ debug: true });
      const config1 = getConfig();
      const config2 = getConfig();
      expect(config1).toBe(config2);
    });
  });

  describe('getConfigValue', () => {
    it('should return specific config value', () => {
      initializeConfig({ debug: true, machineId: 'machine-1' });

      expect(getConfigValue('debug')).toBe(true);
      expect(getConfigValue('machineId')).toBe('machine-1');
    });

    it('should return default value when config value is undefined', () => {
      initializeConfig({});

      expect(getConfigValue('sessionSecret', 'default-secret')).toBe('default-secret');
    });

    it('should return undefined for undefined values without default', () => {
      initializeConfig({});

      expect(getConfigValue('sessionSecret')).toBeUndefined();
    });

    it('should work with Node.js fallback', () => {
      // Without initialization, should use process.env
      expect(getConfigValue('debug', false)).toBeDefined();
    });
  });

  describe('resetConfig', () => {
    it('should clear initialized config', () => {
      initializeConfig({ debug: true });
      expect(isConfigInitialized()).toBe(true);

      resetConfig();
      expect(isConfigInitialized()).toBe(false);
    });

    it('should allow re-initialization after reset', () => {
      initializeConfig({ debug: true });
      resetConfig();
      initializeConfig({ debug: false });

      expect(getConfig().debug).toBe(false);
    });
  });

  describe('isNodeEnvironment', () => {
    it('should return true in Node.js', () => {
      expect(isNodeEnvironment()).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle partial config updates', () => {
      initializeConfig({
        debug: true,
        isDevelopment: false,
      });

      const config = getConfig();
      expect(config.debug).toBe(true);
      expect(config.isDevelopment).toBe(false);
    });

    it('should handle boolean false values correctly', () => {
      initializeConfig({
        debug: false,
        isDevelopment: false,
      });

      const config = getConfig();
      expect(config.debug).toBe(false);
      expect(config.isDevelopment).toBe(false);
    });

    it('should preserve undefined vs explicit values', () => {
      initializeConfig({
        sessionSecret: undefined,
        jwtSecret: 'explicit-secret',
      });

      const config = getConfig();
      expect(config.sessionSecret).toBeUndefined();
      expect(config.jwtSecret).toBe('explicit-secret');
    });
  });
});
