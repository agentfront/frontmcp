// file: plugins/plugin-config/src/__tests__/config.plugin.test.ts
//
// Tests for ConfigPlugin re-exported from @frontmcp/sdk
// This package is deprecated - tests verify re-exports work correctly

import 'reflect-metadata';

import {
  ConfigPlugin,
  ConfigPluginConfigToken,
  ConfigService,
  ConfigMissingError,
  ConfigValidationError,
  loadEnvFiles,
  parseEnvContent,
  populateProcessEnv,
} from '../index';

describe('plugin-config re-exports', () => {
  describe('ConfigPlugin', () => {
    it('should be exported and be a constructor', () => {
      expect(ConfigPlugin).toBeDefined();
      expect(typeof ConfigPlugin).toBe('function');
    });

    it('should have init static method', () => {
      expect(typeof ConfigPlugin.init).toBe('function');
    });

    it('should have defaultOptions', () => {
      expect(ConfigPlugin.defaultOptions).toBeDefined();
      expect(ConfigPlugin.defaultOptions.envPath).toBe('.env');
      expect(ConfigPlugin.defaultOptions.localEnvPath).toBe('.env.local');
      expect(ConfigPlugin.defaultOptions.loadEnv).toBe(true);
    });

    it('should be instantiable', () => {
      const plugin = new ConfigPlugin();
      expect(plugin).toBeDefined();
      expect(plugin.options).toBeDefined();
    });

    it('should merge options with defaults', () => {
      const plugin = new ConfigPlugin({
        envPath: 'custom.env',
        loadEnv: false,
      });

      expect(plugin.options.envPath).toBe('custom.env');
      expect(plugin.options.localEnvPath).toBe('.env.local'); // default
      expect(plugin.options.loadEnv).toBe(false);
    });
  });

  describe('ConfigPluginConfigToken', () => {
    it('should be exported', () => {
      expect(ConfigPluginConfigToken).toBeDefined();
    });
  });

  describe('ConfigService', () => {
    it('should be exported and be a constructor', () => {
      expect(ConfigService).toBeDefined();
      expect(typeof ConfigService).toBe('function');
    });

    it('should be instantiable', () => {
      const service = new ConfigService({ KEY: 'value' });
      expect(service).toBeDefined();
      expect(service.get('KEY')).toBe('value');
    });
  });

  describe('Error classes', () => {
    it('should export ConfigMissingError', () => {
      expect(ConfigMissingError).toBeDefined();
      const error = new ConfigMissingError('KEY');
      expect(error).toBeInstanceOf(Error);
    });

    it('should export ConfigValidationError', () => {
      expect(ConfigValidationError).toBeDefined();
      expect(typeof ConfigValidationError).toBe('function');
    });
  });

  describe('Utility functions', () => {
    it('should export loadEnvFiles', () => {
      expect(loadEnvFiles).toBeDefined();
      expect(typeof loadEnvFiles).toBe('function');
    });

    it('should export parseEnvContent', () => {
      expect(parseEnvContent).toBeDefined();
      expect(typeof parseEnvContent).toBe('function');
    });

    it('should export populateProcessEnv', () => {
      expect(populateProcessEnv).toBeDefined();
      expect(typeof populateProcessEnv).toBe('function');
    });
  });
});

describe('parseEnvContent functionality', () => {
  it('should parse simple KEY=value pairs', () => {
    const content = `
DATABASE_URL=postgres://localhost:5432/db
API_KEY=secret123
`;
    const result = parseEnvContent(content);

    expect(result).toEqual({
      DATABASE_URL: 'postgres://localhost:5432/db',
      API_KEY: 'secret123',
    });
  });

  it('should skip empty lines and comments', () => {
    const content = `
# This is a comment
DATABASE_URL=postgres://localhost

# Another comment
API_KEY=secret
`;
    const result = parseEnvContent(content);

    expect(result).toEqual({
      DATABASE_URL: 'postgres://localhost',
      API_KEY: 'secret',
    });
  });

  it('should handle quoted values', () => {
    const content = `
MESSAGE="Hello World"
PATH='some/path/with spaces'
`;
    const result = parseEnvContent(content);

    expect(result.MESSAGE).toBe('Hello World');
    expect(result.PATH).toBe('some/path/with spaces');
  });

  it('should handle empty values', () => {
    const content = `
EMPTY=
ALSO_EMPTY=""
`;
    const result = parseEnvContent(content);

    expect(result.EMPTY).toBe('');
    expect(result.ALSO_EMPTY).toBe('');
  });
});

describe('populateProcessEnv functionality', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  it('should populate process.env with new values', () => {
    populateProcessEnv({ TEST_NEW_VAR: 'value' });

    expect(process.env.TEST_NEW_VAR).toBe('value');
  });

  it('should not override existing values by default', () => {
    process.env.TEST_EXISTING = 'original';

    populateProcessEnv({ TEST_EXISTING: 'new' });

    expect(process.env.TEST_EXISTING).toBe('original');
  });

  it('should override existing values when override=true', () => {
    process.env.TEST_OVERRIDE = 'original';

    populateProcessEnv({ TEST_OVERRIDE: 'new' }, true);

    expect(process.env.TEST_OVERRIDE).toBe('new');
  });
});
