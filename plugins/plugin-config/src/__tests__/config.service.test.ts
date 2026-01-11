// file: plugins/plugin-config/src/__tests__/config.service.test.ts
//
// Tests for ConfigService re-exported from @frontmcp/sdk
// This package is deprecated - tests verify re-exports work correctly

import 'reflect-metadata';
import { ConfigService, ConfigMissingError, ConfigValidationError } from '../index';

describe('ConfigService (re-exported from SDK)', () => {
  describe('constructor', () => {
    it('should create instance with config values', () => {
      const service = new ConfigService({
        DATABASE_URL: 'postgres://localhost',
        API_KEY: 'secret',
      });

      expect(service.get('DATABASE_URL')).toBe('postgres://localhost');
      expect(service.get('API_KEY')).toBe('secret');
    });
  });

  describe('get', () => {
    const service = new ConfigService({
      STRING_VAL: 'hello',
      NUMBER_VAL: '42',
      EMPTY: '',
    });

    it('should return value for existing key', () => {
      expect(service.get('STRING_VAL')).toBe('hello');
    });

    it('should return undefined for missing key', () => {
      expect(service.get('MISSING')).toBeUndefined();
    });

    it('should return default value for missing key', () => {
      expect(service.get('MISSING', 'default')).toBe('default');
    });

    it('should return empty string for empty value (not default)', () => {
      expect(service.get('EMPTY', 'default')).toBe('');
    });
  });

  describe('getRequired / getOrThrow', () => {
    const service = new ConfigService({
      EXISTS: 'value',
    });

    it('should return value for existing key', () => {
      expect(service.getRequired('EXISTS')).toBe('value');
    });

    it('should throw ConfigMissingError for missing key', () => {
      expect(() => service.getRequired('MISSING')).toThrow(ConfigMissingError);
    });

    it('should include key in error message', () => {
      try {
        service.getRequired('MISSING_KEY');
        fail('Expected error to be thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigMissingError);
        expect((e as ConfigMissingError).key).toBe('MISSING_KEY');
        expect((e as ConfigMissingError).message).toContain('MISSING_KEY');
      }
    });

    it('getOrThrow should be alias for getRequired', () => {
      expect(service.getOrThrow('EXISTS')).toBe('value');
      expect(() => service.getOrThrow('MISSING')).toThrow(ConfigMissingError);
    });
  });

  describe('has', () => {
    const service = new ConfigService({
      EXISTS: 'value',
      EMPTY: '',
    });

    it('should return true for existing key', () => {
      expect(service.has('EXISTS')).toBe(true);
    });

    it('should return true for empty value', () => {
      expect(service.has('EMPTY')).toBe(true);
    });

    it('should return false for missing key', () => {
      expect(service.has('MISSING')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all config values', () => {
      const env = { KEY1: 'val1', KEY2: 'val2' };
      const service = new ConfigService(env);

      const result = service.getAll();

      expect(result).toEqual(env);
    });
  });

  describe('getParsed', () => {
    it('should return config with type cast', () => {
      const service = new ConfigService({ PORT: '3000', DEBUG: 'true' });
      const parsed = service.getParsed<{ PORT: string; DEBUG: string }>();

      expect(parsed.PORT).toBe('3000');
      expect(parsed.DEBUG).toBe('true');
    });
  });

  describe('getNumber', () => {
    const service = new ConfigService({
      PORT: '8080',
      INVALID: 'not-a-number',
      FLOAT: '3.14',
    });

    it('should parse valid number', () => {
      expect(service.getNumber('PORT')).toBe(8080);
    });

    it('should parse float', () => {
      expect(service.getNumber('FLOAT')).toBe(3.14);
    });

    it('should return NaN for invalid number', () => {
      expect(service.getNumber('INVALID')).toBeNaN();
    });

    it('should return default for invalid number', () => {
      expect(service.getNumber('INVALID', 999)).toBe(999);
    });

    it('should return default for missing key', () => {
      expect(service.getNumber('MISSING', 42)).toBe(42);
    });

    it('should return NaN for missing key without default', () => {
      expect(service.getNumber('MISSING')).toBeNaN();
    });
  });

  describe('getBoolean', () => {
    const service = new ConfigService({
      TRUE_LOWER: 'true',
      TRUE_UPPER: 'TRUE',
      TRUE_ONE: '1',
      TRUE_YES: 'yes',
      TRUE_ON: 'on',
      FALSE_LOWER: 'false',
      FALSE_ZERO: '0',
      FALSE_NO: 'no',
      FALSE_OFF: 'off',
      RANDOM: 'random',
    });

    it('should return true for truthy values', () => {
      expect(service.getBoolean('TRUE_LOWER')).toBe(true);
      expect(service.getBoolean('TRUE_UPPER')).toBe(true);
      expect(service.getBoolean('TRUE_ONE')).toBe(true);
      expect(service.getBoolean('TRUE_YES')).toBe(true);
      expect(service.getBoolean('TRUE_ON')).toBe(true);
    });

    it('should return false for falsy values', () => {
      expect(service.getBoolean('FALSE_LOWER')).toBe(false);
      expect(service.getBoolean('FALSE_ZERO')).toBe(false);
      expect(service.getBoolean('FALSE_NO')).toBe(false);
      expect(service.getBoolean('FALSE_OFF')).toBe(false);
    });

    it('should return false for unknown values', () => {
      expect(service.getBoolean('RANDOM')).toBe(false);
    });

    it('should return default for missing key', () => {
      expect(service.getBoolean('MISSING', true)).toBe(true);
      expect(service.getBoolean('MISSING', false)).toBe(false);
    });

    it('should return false for missing key without default', () => {
      expect(service.getBoolean('MISSING')).toBe(false);
    });
  });
});

describe('ConfigMissingError', () => {
  it('should have correct name', () => {
    const error = new ConfigMissingError('KEY');
    expect(error.name).toBe('ConfigMissingError');
  });

  it('should store key', () => {
    const error = new ConfigMissingError('DATABASE_URL');
    expect(error.key).toBe('DATABASE_URL');
  });

  it('should include key in message', () => {
    const error = new ConfigMissingError('API_KEY');
    expect(error.message).toContain('API_KEY');
  });

  it('should extend Error', () => {
    const error = new ConfigMissingError('KEY');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ConfigValidationError', () => {
  it('should be exported and constructable', () => {
    // ConfigValidationError requires a ZodError, verify it's exported
    expect(ConfigValidationError).toBeDefined();
    expect(typeof ConfigValidationError).toBe('function');
  });

  it('should format Zod errors with paths', () => {
    const { z } = require('zod');
    const zodError = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
        path: ['database', 'url'],
        message: 'Expected string',
      },
    ]);
    const error = new ConfigValidationError('Validation failed', zodError);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error.name).toBe('ConfigValidationError');
    expect(error.message).toContain('database.url');
    expect(error.message).toContain('Expected string');
    expect(error.zodError).toBe(zodError);
  });

  it('should handle multiple validation errors', () => {
    const { z } = require('zod');
    const zodError = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        path: ['api', 'key'],
        message: 'Required',
      },
      {
        code: 'too_small',
        minimum: 1,
        type: 'number',
        inclusive: true,
        path: ['port'],
        message: 'Too small',
      },
    ]);
    const error = new ConfigValidationError('Config invalid', zodError);

    expect(error.message).toContain('api.key');
    expect(error.message).toContain('port');
    expect(error.message).toContain('Required');
    expect(error.message).toContain('Too small');
  });

  it('should handle empty path errors', () => {
    const { z } = require('zod');
    const zodError = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'object',
        received: 'undefined',
        path: [],
        message: 'Required',
      },
    ]);
    const error = new ConfigValidationError('Root validation failed', zodError);

    expect(error.message).toContain('Root validation failed');
    expect(error.message).toContain('Required');
  });
});
