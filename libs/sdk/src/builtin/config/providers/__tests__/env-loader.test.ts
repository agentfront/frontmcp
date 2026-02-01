import { z } from 'zod';
import * as path from 'path';
import {
  setNestedValue,
  getNestedValue,
  pathToEnvKey,
  mapEnvToNestedConfig,
  parseEnvContent,
  parseEnvContentSync,
  loadEnvFiles,
  populateProcessEnv,
  extractSchemaPaths,
} from '../env-loader';

describe('env-loader', () => {
  describe('pathToEnvKey', () => {
    it('should convert path to uppercase with underscores', () => {
      expect(pathToEnvKey('database.url')).toBe('DATABASE_URL');
      expect(pathToEnvKey('api.key')).toBe('API_KEY');
      expect(pathToEnvKey('debug')).toBe('DEBUG');
    });
  });

  describe('setNestedValue', () => {
    it('should set a value at a nested path', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'database.url', 'postgres://localhost');
      expect(obj).toEqual({ database: { url: 'postgres://localhost' } });
    });

    it('should set a value at a shallow path', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'debug', true);
      expect(obj).toEqual({ debug: true });
    });

    it('should overwrite existing values', () => {
      const obj: Record<string, unknown> = { database: { url: 'old' } };
      setNestedValue(obj, 'database.url', 'new');
      expect(obj).toEqual({ database: { url: 'new' } });
    });

    describe('prototype pollution protection', () => {
      it('should block __proto__ pollution', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, '__proto__.polluted', 'bad');

        expect(({} as any).polluted).toBeUndefined();
        expect(obj).toEqual({});
      });

      it('should block nested __proto__ pollution', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, 'foo.__proto__.polluted', 'bad');

        expect(({} as any).polluted).toBeUndefined();
        expect(obj).toEqual({});
      });

      it('should block constructor pollution', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, 'constructor.prototype.polluted', 'bad');

        expect(({} as any).polluted).toBeUndefined();
        expect(obj).toEqual({});
      });

      it('should block prototype pollution', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, 'prototype.polluted', 'bad');
        expect(obj).toEqual({});
      });

      it('should allow safe keys that look similar', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, '__proto', 'safe');
        setNestedValue(obj, 'proto__', 'safe');
        setNestedValue(obj, 'constructorValue', 'safe');
        expect(obj).toEqual({
          __proto: 'safe',
          proto__: 'safe',
          constructorValue: 'safe',
        });
      });
    });
  });

  describe('getNestedValue', () => {
    it('should get a value from a nested path', () => {
      const obj = { database: { url: 'postgres://localhost' } };
      expect(getNestedValue(obj, 'database.url')).toBe('postgres://localhost');
    });

    it('should get a value from a shallow path', () => {
      const obj = { debug: true };
      expect(getNestedValue(obj, 'debug')).toBe(true);
    });

    it('should return undefined for non-existent paths', () => {
      const obj = { database: { url: 'postgres://localhost' } };
      expect(getNestedValue(obj, 'database.port')).toBeUndefined();
      expect(getNestedValue(obj, 'missing.path')).toBeUndefined();
    });

    describe('prototype pollution protection', () => {
      it('should block __proto__ access', () => {
        const obj = { foo: 'bar' };
        expect(getNestedValue(obj, '__proto__')).toBeUndefined();
      });

      it('should block nested __proto__ access', () => {
        const obj = { foo: { bar: 'baz' } };
        expect(getNestedValue(obj, 'foo.__proto__')).toBeUndefined();
      });

      it('should block constructor access', () => {
        const obj = { foo: 'bar' };
        expect(getNestedValue(obj, 'constructor')).toBeUndefined();
      });

      it('should block prototype access', () => {
        const obj = { foo: 'bar' };
        expect(getNestedValue(obj, 'prototype')).toBeUndefined();
      });
    });
  });

  describe('mapEnvToNestedConfig', () => {
    it('should map flat env vars to nested config', () => {
      const env = {
        DATABASE_URL: 'postgres://localhost',
        DATABASE_PORT: '5432',
        DEBUG: 'true',
      };
      const paths = ['database.url', 'database.port', 'debug'];
      const result = mapEnvToNestedConfig(env, paths);

      expect(result).toEqual({
        database: {
          url: 'postgres://localhost',
          port: '5432',
        },
        debug: 'true',
      });
    });

    it('should skip missing env vars', () => {
      const env = {
        DATABASE_URL: 'postgres://localhost',
      };
      const paths = ['database.url', 'database.port'];
      const result = mapEnvToNestedConfig(env, paths);

      expect(result).toEqual({
        database: {
          url: 'postgres://localhost',
        },
      });
    });
  });

  describe('parseEnvContent', () => {
    describe('basic key-value parsing', () => {
      it('should parse unquoted values', () => {
        const content = 'KEY=value\nANOTHER=123';
        const result = parseEnvContent(content);
        expect(result).toEqual({
          KEY: 'value',
          ANOTHER: '123',
        });
      });

      it('should parse single-quoted values', () => {
        const content = "KEY='quoted value'\nPATH='some/path'";
        const result = parseEnvContent(content);
        expect(result).toEqual({
          KEY: 'quoted value',
          PATH: 'some/path',
        });
      });

      it('should parse double-quoted values', () => {
        const content = 'KEY="quoted value"\nPATH="some/path"';
        const result = parseEnvContent(content);
        expect(result).toEqual({
          KEY: 'quoted value',
          PATH: 'some/path',
        });
      });

      it('should handle empty values', () => {
        const content = 'EMPTY=\nALSO_EMPTY=""';
        const result = parseEnvContent(content);
        expect(result.EMPTY).toBe('');
        expect(result.ALSO_EMPTY).toBe('');
      });

      it('should handle values with equals signs', () => {
        const content = 'CONNECTION=host=localhost;user=admin';
        const result = parseEnvContent(content);
        expect(result.CONNECTION).toBe('host=localhost;user=admin');
      });
    });

    describe('escape sequences in double-quoted values', () => {
      it('should expand \\n to newline', () => {
        const content = 'MSG="line1\\nline2"';
        const result = parseEnvContent(content);
        expect(result.MSG).toBe('line1\nline2');
      });

      it('should expand \\r to carriage return', () => {
        const content = 'MSG="line1\\rline2"';
        const result = parseEnvContent(content);
        expect(result.MSG).toBe('line1\rline2');
      });

      it('should expand \\t to tab', () => {
        const content = 'MSG="col1\\tcol2"';
        const result = parseEnvContent(content);
        expect(result.MSG).toBe('col1\tcol2');
      });

      it('should expand \\\\ to single backslash', () => {
        const content = 'PATH="C:\\\\Windows\\\\System32"';
        const result = parseEnvContent(content);
        expect(result.PATH).toBe('C:\\Windows\\System32');
      });

      it('should handle multiple escape sequences', () => {
        const content = 'MSG="line1\\n\\tindented\\nline3"';
        const result = parseEnvContent(content);
        expect(result.MSG).toBe('line1\n\tindented\nline3');
      });

      it('should not expand escape sequences in single-quoted values', () => {
        const content = "MSG='line1\\nline2'";
        const result = parseEnvContent(content);
        expect(result.MSG).toBe('line1\\nline2');
      });
    });

    describe('comments and empty lines', () => {
      it('should skip comment lines', () => {
        const content = '# This is a comment\nKEY=value\n# Another comment';
        const result = parseEnvContent(content);
        expect(result).toEqual({ KEY: 'value' });
        expect(Object.keys(result)).toHaveLength(1);
      });

      it('should skip empty lines', () => {
        const content = 'KEY1=value1\n\n\nKEY2=value2';
        const result = parseEnvContent(content);
        expect(result).toEqual({
          KEY1: 'value1',
          KEY2: 'value2',
        });
      });

      it('should skip lines with only whitespace', () => {
        const content = 'KEY1=value1\n   \n\t\nKEY2=value2';
        const result = parseEnvContent(content);
        expect(result).toEqual({
          KEY1: 'value1',
          KEY2: 'value2',
        });
      });
    });

    describe('edge cases', () => {
      it('should handle keys with underscores and numbers', () => {
        const content = 'MY_VAR_1=value1\n_UNDERSCORE=value2\nVAR2_NAME=value3';
        const result = parseEnvContent(content);
        expect(result).toEqual({
          MY_VAR_1: 'value1',
          _UNDERSCORE: 'value2',
          VAR2_NAME: 'value3',
        });
      });

      it('should trim whitespace around values', () => {
        const content = 'KEY=  value  ';
        const result = parseEnvContent(content);
        expect(result.KEY).toBe('value');
      });

      it('should handle empty content', () => {
        const result = parseEnvContent('');
        expect(result).toEqual({});
      });

      it('should handle content with only comments', () => {
        const content = '# Comment 1\n# Comment 2';
        const result = parseEnvContent(content);
        expect(result).toEqual({});
      });

      it('should skip invalid lines without equals', () => {
        const content = 'VALID=value\nINVALID_LINE\nALSO_VALID=test';
        const result = parseEnvContent(content);
        expect(result).toEqual({
          VALID: 'value',
          ALSO_VALID: 'test',
        });
      });
    });
  });

  describe('parseEnvContentSync', () => {
    it('should behave identically to parseEnvContent', () => {
      const content = 'KEY1=value1\nKEY2="quoted"\n# comment\nKEY3=123';
      const asyncResult = parseEnvContent(content);
      const syncResult = parseEnvContentSync(content);
      expect(syncResult).toEqual(asyncResult);
    });

    it('should handle escape sequences', () => {
      const content = 'MSG="line1\\nline2"';
      const result = parseEnvContentSync(content);
      expect(result.MSG).toBe('line1\nline2');
    });
  });

  describe('populateProcessEnv', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Clean up test vars
      delete process.env.TEST_POPULATE_VAR;
      delete process.env.TEST_EXISTING_VAR;
      delete process.env.TEST_OVERRIDE_VAR;
    });

    afterEach(() => {
      // Restore original env
      delete process.env.TEST_POPULATE_VAR;
      delete process.env.TEST_EXISTING_VAR;
      delete process.env.TEST_OVERRIDE_VAR;
    });

    it('should populate process.env with new values', () => {
      populateProcessEnv({ TEST_POPULATE_VAR: 'new_value' });
      expect(process.env.TEST_POPULATE_VAR).toBe('new_value');
    });

    it('should not override existing values by default', () => {
      process.env.TEST_EXISTING_VAR = 'original';
      populateProcessEnv({ TEST_EXISTING_VAR: 'new' });
      expect(process.env.TEST_EXISTING_VAR).toBe('original');
    });

    it('should override existing values when override=true', () => {
      process.env.TEST_OVERRIDE_VAR = 'original';
      populateProcessEnv({ TEST_OVERRIDE_VAR: 'new' }, true);
      expect(process.env.TEST_OVERRIDE_VAR).toBe('new');
    });

    it('should handle multiple values', () => {
      populateProcessEnv({
        TEST_VAR_A: 'valueA',
        TEST_VAR_B: 'valueB',
      });
      expect(process.env.TEST_VAR_A).toBe('valueA');
      expect(process.env.TEST_VAR_B).toBe('valueB');

      // Clean up
      delete process.env.TEST_VAR_A;
      delete process.env.TEST_VAR_B;
    });
  });

  describe('loadEnvFiles', () => {
    // Construct path to demo-e2e-config fixtures using explicit segments
    // __dirname = libs/sdk/src/builtin/config/providers/__tests__
    // Project root = 7 levels up, then into apps/e2e/demo-e2e-config
    const projectRoot = path.join(__dirname, '..', '..', '..', '..', '..', '..', '..');
    const fixturesPath = path.join(projectRoot, 'apps', 'e2e', 'demo-e2e-config');

    it('should load env files from a directory', async () => {
      const result = await loadEnvFiles(fixturesPath, '.env', '.env.local');
      // Should have loaded some values
      expect(typeof result).toBe('object');
    });

    it('should return empty object for non-existent directory', async () => {
      const result = await loadEnvFiles('/non/existent/path', '.env', '.env.local');
      expect(result).toEqual({});
    });

    it('should return empty object for non-existent files', async () => {
      const result = await loadEnvFiles(__dirname, 'non-existent.env', 'also-missing.env');
      expect(result).toEqual({});
    });

    it('should have .env.local values override .env values', async () => {
      // This tests the merging precedence - .env.local should override .env
      const result = await loadEnvFiles(fixturesPath, '.env', '.env.local');

      // Verify override behavior:
      // .env has API_KEY=test-api-key-12345
      // .env.local has API_KEY=local-override-key
      expect(result.API_KEY).toBe('local-override-key');
    });
  });

  describe('extractSchemaPaths', () => {
    it('should extract paths from simple object schema', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });
      const paths = extractSchemaPaths(schema);
      expect(paths).toContain('name');
      expect(paths).toContain('age');
    });

    it('should extract nested paths from nested object schema', () => {
      const schema = z.object({
        database: z.object({
          url: z.string(),
          port: z.number(),
        }),
        debug: z.boolean(),
      });
      const paths = extractSchemaPaths(schema);
      expect(paths).toContain('database');
      expect(paths).toContain('database.url');
      expect(paths).toContain('database.port');
      expect(paths).toContain('debug');
    });

    it('should handle deeply nested schemas', () => {
      const schema = z.object({
        level1: z.object({
          level2: z.object({
            level3: z.string(),
          }),
        }),
      });
      const paths = extractSchemaPaths(schema);
      expect(paths).toContain('level1');
      expect(paths).toContain('level1.level2');
      expect(paths).toContain('level1.level2.level3');
    });

    it('should handle schemas with optional fields', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });
      const paths = extractSchemaPaths(schema);
      expect(paths).toContain('required');
      expect(paths).toContain('optional');
    });

    it('should handle schemas with default values', () => {
      const schema = z.object({
        withDefault: z.string().default('default'),
        nested: z
          .object({
            inner: z.number().default(42),
          })
          .default({}),
      });
      const paths = extractSchemaPaths(schema);
      expect(paths).toContain('withDefault');
      expect(paths).toContain('nested');
      expect(paths).toContain('nested.inner');
    });

    it('should handle schemas with nullable fields', () => {
      const schema = z.object({
        nullable: z.string().nullable(),
        nested: z
          .object({
            inner: z.number().nullable(),
          })
          .nullable(),
      });
      const paths = extractSchemaPaths(schema);
      expect(paths).toContain('nullable');
      expect(paths).toContain('nested');
    });

    it('should return empty array for non-object schemas', () => {
      const schema = z.string();
      const paths = extractSchemaPaths(schema);
      expect(paths).toEqual([]);
    });

    it('should handle empty object schema', () => {
      const schema = z.object({});
      const paths = extractSchemaPaths(schema);
      expect(paths).toEqual([]);
    });

    it('should handle array fields as leaf nodes', () => {
      const schema = z.object({
        tags: z.array(z.string()),
        nested: z.object({
          items: z.array(z.number()),
        }),
      });
      const paths = extractSchemaPaths(schema);
      expect(paths).toContain('tags');
      expect(paths).toContain('nested');
      expect(paths).toContain('nested.items');
    });
  });
});
