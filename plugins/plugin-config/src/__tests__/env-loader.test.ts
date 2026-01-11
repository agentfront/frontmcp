// file: plugins/plugin-config/src/__tests__/env-loader.test.ts
//
// Tests for env-loader functions re-exported from @frontmcp/sdk
// This package is deprecated - tests verify re-exports work correctly

import 'reflect-metadata';
import { parseEnvContent, loadEnvFiles, populateProcessEnv } from '../index';

describe('env-loader re-exports', () => {
  describe('parseEnvContent', () => {
    it('should be exported', () => {
      expect(parseEnvContent).toBeDefined();
      expect(typeof parseEnvContent).toBe('function');
    });

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

    it('should handle double-quoted values', () => {
      const content = `
MESSAGE="Hello World"
PATH="some/path/with spaces"
`;
      const result = parseEnvContent(content);

      expect(result).toEqual({
        MESSAGE: 'Hello World',
        PATH: 'some/path/with spaces',
      });
    });

    it('should handle single-quoted values', () => {
      const content = `
MESSAGE='Hello World'
`;
      const result = parseEnvContent(content);

      expect(result).toEqual({
        MESSAGE: 'Hello World',
      });
    });

    it('should handle values with equals signs', () => {
      const content = `
CONNECTION_STRING=host=localhost;user=admin
`;
      const result = parseEnvContent(content);

      expect(result['CONNECTION_STRING']).toBe('host=localhost;user=admin');
    });

    it('should handle empty values', () => {
      const content = `
EMPTY=
ALSO_EMPTY=""
`;
      const result = parseEnvContent(content);

      expect(result['EMPTY']).toBe('');
      expect(result['ALSO_EMPTY']).toBe('');
    });

    it('should handle keys with underscores and numbers', () => {
      const content = `
MY_VAR_1=value1
_UNDERSCORE_START=value2
VAR_2_NAME=value3
`;
      const result = parseEnvContent(content);

      expect(result).toEqual({
        MY_VAR_1: 'value1',
        _UNDERSCORE_START: 'value2',
        VAR_2_NAME: 'value3',
      });
    });
  });

  describe('loadEnvFiles', () => {
    it('should be exported', () => {
      expect(loadEnvFiles).toBeDefined();
      expect(typeof loadEnvFiles).toBe('function');
    });

    // Note: Detailed file loading tests should be in SDK tests
    // These are just basic re-export verification tests
  });

  describe('populateProcessEnv', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Clean up test vars
      delete process.env['TEST_POPULATE_VAR'];
      delete process.env['TEST_EXISTING_VAR'];
      delete process.env['TEST_OVERRIDE_VAR'];
    });

    afterEach(() => {
      // Restore original env
      delete process.env['TEST_POPULATE_VAR'];
      delete process.env['TEST_EXISTING_VAR'];
      delete process.env['TEST_OVERRIDE_VAR'];
    });

    it('should be exported', () => {
      expect(populateProcessEnv).toBeDefined();
      expect(typeof populateProcessEnv).toBe('function');
    });

    it('should populate process.env with new values', () => {
      populateProcessEnv({ TEST_POPULATE_VAR: 'value' });

      expect(process.env['TEST_POPULATE_VAR']).toBe('value');
    });

    it('should not override existing values by default', () => {
      process.env['TEST_EXISTING_VAR'] = 'original';

      populateProcessEnv({ TEST_EXISTING_VAR: 'new' });

      expect(process.env['TEST_EXISTING_VAR']).toBe('original');
    });

    it('should override existing values when override=true', () => {
      process.env['TEST_OVERRIDE_VAR'] = 'original';

      populateProcessEnv({ TEST_OVERRIDE_VAR: 'new' }, true);

      expect(process.env['TEST_OVERRIDE_VAR']).toBe('new');
    });

    it('should handle multiple values', () => {
      populateProcessEnv({
        TEST_VAR1: 'value1',
        TEST_VAR2: 'value2',
        TEST_VAR3: 'value3',
      });

      expect(process.env['TEST_VAR1']).toBe('value1');
      expect(process.env['TEST_VAR2']).toBe('value2');
      expect(process.env['TEST_VAR3']).toBe('value3');

      // Clean up
      delete process.env['TEST_VAR1'];
      delete process.env['TEST_VAR2'];
      delete process.env['TEST_VAR3'];
    });
  });
});
