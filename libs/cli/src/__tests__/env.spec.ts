// file: libs/cli/src/__tests__/env.spec.ts

import * as path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

// Mock colors
jest.mock('../colors', () => ({
  c: jest.fn((color: string, text: string) => `[${color}]${text}`),
}));

import * as fs from 'fs';
import { parseEnvContent, loadEnvFilesSync, populateProcessEnv, loadDevEnv } from '../utils/env';

describe('env utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseEnvContent', () => {
    it('should parse simple KEY=value pairs', () => {
      const content = 'FOO=bar\nBAZ=qux';
      const result = parseEnvContent(content);
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('should skip empty lines', () => {
      const content = 'FOO=bar\n\n\nBAZ=qux';
      const result = parseEnvContent(content);
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('should skip comment lines starting with #', () => {
      const content = '# This is a comment\nFOO=bar\n# Another comment\nBAZ=qux';
      const result = parseEnvContent(content);
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('should handle double-quoted values and remove quotes', () => {
      const content = 'FOO="hello world"\nBAR="value with spaces"';
      const result = parseEnvContent(content);
      expect(result).toEqual({ FOO: 'hello world', BAR: 'value with spaces' });
    });

    it('should handle single-quoted values and remove quotes', () => {
      const content = "FOO='hello world'\nBAR='value with spaces'";
      const result = parseEnvContent(content);
      expect(result).toEqual({ FOO: 'hello world', BAR: 'value with spaces' });
    });

    it('should expand escape sequences in double-quoted values', () => {
      const content = 'FOO="line1\\nline2"\nBAR="tab\\there"\nBAZ="return\\rhere"';
      const result = parseEnvContent(content);
      expect(result).toEqual({
        FOO: 'line1\nline2',
        BAR: 'tab\there',
        BAZ: 'return\rhere',
      });
    });

    it('should handle escaped backslash in double-quoted values', () => {
      const content = 'PATH="C:\\\\Users\\\\test"';
      const result = parseEnvContent(content);
      expect(result).toEqual({ PATH: 'C:\\Users\\test' });
    });

    it('should NOT expand escape sequences in single-quoted values', () => {
      const content = "FOO='line1\\nline2'";
      const result = parseEnvContent(content);
      expect(result).toEqual({ FOO: 'line1\\nline2' });
    });

    it('should handle values without quotes', () => {
      const content = 'FOO=bar\nBAZ=123';
      const result = parseEnvContent(content);
      expect(result).toEqual({ FOO: 'bar', BAZ: '123' });
    });

    it('should ignore invalid lines without = sign', () => {
      const content = 'FOO=bar\nINVALID_LINE\nBAZ=qux';
      const result = parseEnvContent(content);
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('should handle keys with numbers and underscores', () => {
      const content = 'FOO_BAR=value1\nBAZ_123=value2\n_UNDERSCORE=value3';
      const result = parseEnvContent(content);
      expect(result).toEqual({
        FOO_BAR: 'value1',
        BAZ_123: 'value2',
        _UNDERSCORE: 'value3',
      });
    });

    it('should reject keys starting with numbers', () => {
      const content = '123_INVALID=value\nVALID_KEY=value';
      const result = parseEnvContent(content);
      expect(result).toEqual({ VALID_KEY: 'value' });
    });

    it('should trim whitespace around values', () => {
      const content = 'FOO=  bar  \nBAZ=  qux  ';
      const result = parseEnvContent(content);
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('should handle empty values', () => {
      const content = 'EMPTY=\nANOTHER=""';
      const result = parseEnvContent(content);
      expect(result).toEqual({ EMPTY: '', ANOTHER: '' });
    });

    it('should handle values with = sign in them', () => {
      const content = 'EQUATION=a=b+c';
      const result = parseEnvContent(content);
      expect(result).toEqual({ EQUATION: 'a=b+c' });
    });

    it('should handle lines with only whitespace', () => {
      const content = 'FOO=bar\n   \t  \nBAZ=qux';
      const result = parseEnvContent(content);
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('should return empty object for empty content', () => {
      const result = parseEnvContent('');
      expect(result).toEqual({});
    });
  });

  describe('loadEnvFilesSync', () => {
    const basePath = '/test/project';

    it('should load .env file when it exists', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        return p === path.resolve(basePath, '.env');
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('FOO=bar\nBAZ=qux');

      const result = loadEnvFilesSync(basePath);

      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
      expect(fs.existsSync).toHaveBeenCalledWith(path.resolve(basePath, '.env'));
    });

    it('should load .env.local override when it exists', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        return p === path.resolve(basePath, '.env.local');
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('LOCAL_VAR=value');

      const result = loadEnvFilesSync(basePath);

      expect(result).toEqual({ LOCAL_VAR: 'value' });
    });

    it('should merge .env and .env.local with local overriding base', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
        if (p === path.resolve(basePath, '.env')) {
          return 'FOO=base\nBAR=base_only';
        }
        if (p === path.resolve(basePath, '.env.local')) {
          return 'FOO=local\nLOCAL_ONLY=value';
        }
        return '';
      });

      const result = loadEnvFilesSync(basePath);

      expect(result).toEqual({
        FOO: 'local', // overridden by .env.local
        BAR: 'base_only',
        LOCAL_ONLY: 'value',
      });
    });

    it('should return empty object when neither file exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = loadEnvFilesSync(basePath);

      expect(result).toEqual({});
    });

    it('should use custom paths when provided', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        return p === path.resolve(basePath, 'custom.env');
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('CUSTOM=value');

      const result = loadEnvFilesSync(basePath, 'custom.env', 'custom.local.env');

      expect(result).toEqual({ CUSTOM: 'value' });
      expect(fs.existsSync).toHaveBeenCalledWith(path.resolve(basePath, 'custom.env'));
      expect(fs.existsSync).toHaveBeenCalledWith(path.resolve(basePath, 'custom.local.env'));
    });

    it('should use process.cwd() as default basePath', () => {
      const originalCwd = process.cwd();
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      loadEnvFilesSync();

      expect(fs.existsSync).toHaveBeenCalledWith(path.resolve(originalCwd, '.env'));
    });
  });

  describe('populateProcessEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should populate process.env with values', () => {
      const env = { NEW_VAR: 'new_value', ANOTHER: 'test' };

      populateProcessEnv(env);

      expect(process.env.NEW_VAR).toBe('new_value');
      expect(process.env.ANOTHER).toBe('test');
    });

    it('should not override existing values by default', () => {
      process.env.EXISTING = 'original';
      const env = { EXISTING: 'new_value', NEW_VAR: 'test' };

      populateProcessEnv(env);

      expect(process.env.EXISTING).toBe('original');
      expect(process.env.NEW_VAR).toBe('test');
    });

    it('should override existing values when override=true', () => {
      process.env.EXISTING = 'original';
      const env = { EXISTING: 'new_value' };

      populateProcessEnv(env, true);

      expect(process.env.EXISTING).toBe('new_value');
    });

    it('should handle empty env object', () => {
      const originalKeys = Object.keys(process.env);
      populateProcessEnv({});
      expect(Object.keys(process.env)).toEqual(originalKeys);
    });
  });

  describe('loadDevEnv', () => {
    const originalEnv = process.env;
    let consoleSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      process.env = { ...originalEnv };
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should load env files and log count of variables', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        return p.endsWith('.env');
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('VAR1=value1\nVAR2=value2');

      loadDevEnv('/test/cwd');

      expect(process.env.VAR1).toBe('value1');
      expect(process.env.VAR2).toBe('value2');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('loaded 2 environment variables'));
    });

    it('should use singular "variable" for count of 1', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        return p.endsWith('.env');
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('SINGLE=value');

      loadDevEnv('/test/cwd');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('loaded 1 environment variable'));
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('variables'));
    });

    it('should not log if no variables are loaded', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      loadDevEnv('/test/cwd');

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should handle error gracefully with warning', () => {
      (fs.existsSync as jest.Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      loadDevEnv('/test/cwd');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to load .env files: Permission denied'));
    });

    it('should handle non-Error throws gracefully', () => {
      (fs.existsSync as jest.Mock).mockImplementation(() => {
        throw 'string error';
      });

      loadDevEnv('/test/cwd');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to load .env files: string error'));
    });
  });
});
