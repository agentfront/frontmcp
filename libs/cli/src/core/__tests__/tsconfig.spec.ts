// file: libs/cli/src/core/__tests__/tsconfig.spec.ts

import * as path from 'path';

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => {
  return {
    fileExists: jest.fn(),
    readJSON: jest.fn(),
    writeJSON: jest.fn(),
  };
});

import {
  REQUIRED_DECORATOR_FIELDS,
  RECOMMENDED_TSCONFIG,
  deepMerge,
  ensureRequiredTsOptions,
  checkRequiredTsOptions,
  runInit,
} from '../tsconfig';
import { fileExists, readJSON, writeJSON } from '@frontmcp/utils';

describe('tsconfig utilities', () => {
  describe('REQUIRED_DECORATOR_FIELDS', () => {
    it('should have correct required fields', () => {
      expect(REQUIRED_DECORATOR_FIELDS.target).toBe('es2021');
      expect(REQUIRED_DECORATOR_FIELDS.module).toBe('esnext');
      expect(REQUIRED_DECORATOR_FIELDS.emitDecoratorMetadata).toBe(true);
      expect(REQUIRED_DECORATOR_FIELDS.experimentalDecorators).toBe(true);
      expect(REQUIRED_DECORATOR_FIELDS.strictFunctionTypes).toBe(true);
      expect(REQUIRED_DECORATOR_FIELDS.moduleResolution).toBe('node');
    });
  });

  describe('RECOMMENDED_TSCONFIG', () => {
    it('should have compilerOptions with required fields', () => {
      expect(RECOMMENDED_TSCONFIG.compilerOptions.target).toBe('es2021');
      expect(RECOMMENDED_TSCONFIG.compilerOptions.module).toBe('esnext');
      expect(RECOMMENDED_TSCONFIG.compilerOptions.emitDecoratorMetadata).toBe(true);
      expect(RECOMMENDED_TSCONFIG.compilerOptions.experimentalDecorators).toBe(true);
    });

    it('should have include array', () => {
      expect(RECOMMENDED_TSCONFIG.include).toEqual(['src/**/*']);
    });
  });

  describe('deepMerge', () => {
    it('should merge flat objects', () => {
      const base = { a: 1, b: 2 };
      const patch = { b: 3, c: 4 };
      const result = deepMerge(base, patch);
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should deep merge nested objects', () => {
      const base = { nested: { a: 1, b: 2 } };
      const patch = { nested: { b: 3, c: 4 } };
      const result = deepMerge(base, patch);
      expect(result).toEqual({ nested: { a: 1, b: 3, c: 4 } });
    });

    it('should handle missing nested in base', () => {
      const base = {} as any;
      const patch = { nested: { a: 1 } };
      const result = deepMerge(base, patch);
      expect(result).toEqual({ nested: { a: 1 } });
    });

    it('should overwrite arrays (not merge them)', () => {
      const base = { arr: [1, 2, 3] };
      const patch = { arr: [4, 5] };
      const result = deepMerge(base, patch);
      expect(result.arr).toEqual([4, 5]);
    });

    it('should handle null values in patch', () => {
      const base = { a: 1, b: { c: 2 } };
      const patch = { b: null } as any;
      const result = deepMerge(base, patch);
      expect(result.b).toBeNull();
    });

    it('should handle undefined values', () => {
      const base = { a: 1 };
      const patch = { b: undefined };
      const result = deepMerge(base, patch);
      expect(result.b).toBeUndefined();
    });
  });

  describe('ensureRequiredTsOptions', () => {
    it('should add required fields to empty config', () => {
      const result = ensureRequiredTsOptions({});
      expect(result.compilerOptions.target).toBe('es2021');
      expect(result.compilerOptions.module).toBe('esnext');
      expect(result.compilerOptions.emitDecoratorMetadata).toBe(true);
      expect(result.compilerOptions.experimentalDecorators).toBe(true);
    });

    it('should override existing values', () => {
      const result = ensureRequiredTsOptions({
        compilerOptions: {
          target: 'es5',
          module: 'commonjs',
          emitDecoratorMetadata: false,
          experimentalDecorators: false,
        },
      });
      expect(result.compilerOptions.target).toBe('es2021');
      expect(result.compilerOptions.module).toBe('esnext');
      expect(result.compilerOptions.emitDecoratorMetadata).toBe(true);
      expect(result.compilerOptions.experimentalDecorators).toBe(true);
    });

    it('should preserve other compiler options', () => {
      const result = ensureRequiredTsOptions({
        compilerOptions: {
          strict: true,
          outDir: 'dist',
        },
      });
      expect(result.compilerOptions.strict).toBe(true);
      expect(result.compilerOptions.outDir).toBe('dist');
    });

    it('should preserve non-compilerOptions fields', () => {
      const result = ensureRequiredTsOptions({
        include: ['src/**/*'],
        exclude: ['node_modules'],
      });
      expect(result.include).toEqual(['src/**/*']);
      expect(result.exclude).toEqual(['node_modules']);
    });
  });

  describe('checkRequiredTsOptions', () => {
    it('should return all ok for correct config', () => {
      const { ok, issues } = checkRequiredTsOptions({
        target: 'es2021',
        module: 'esnext',
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      });
      expect(ok.length).toBe(4);
      expect(issues.length).toBe(0);
    });

    it('should return issues for incorrect target', () => {
      const { ok, issues } = checkRequiredTsOptions({
        target: 'es5',
        module: 'esnext',
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      });
      expect(ok.length).toBe(3);
      expect(issues.length).toBe(1);
      expect(issues[0]).toContain('target');
    });

    it('should return issues for incorrect module', () => {
      const { ok, issues } = checkRequiredTsOptions({
        target: 'es2021',
        module: 'commonjs',
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      });
      expect(issues.length).toBe(1);
      expect(issues[0]).toContain('module');
    });

    it('should return issues for false emitDecoratorMetadata', () => {
      const { ok, issues } = checkRequiredTsOptions({
        target: 'es2021',
        module: 'esnext',
        emitDecoratorMetadata: false,
        experimentalDecorators: true,
      });
      expect(issues.length).toBe(1);
      expect(issues[0]).toContain('emitDecoratorMetadata');
    });

    it('should return issues for false experimentalDecorators', () => {
      const { ok, issues } = checkRequiredTsOptions({
        target: 'es2021',
        module: 'esnext',
        emitDecoratorMetadata: true,
        experimentalDecorators: false,
      });
      expect(issues.length).toBe(1);
      expect(issues[0]).toContain('experimentalDecorators');
    });

    it('should handle undefined compilerOptions', () => {
      const { ok, issues } = checkRequiredTsOptions(undefined);
      expect(issues.length).toBe(4);
      expect(ok.length).toBe(0);
    });

    it('should handle case-insensitive target and module', () => {
      const { ok, issues } = checkRequiredTsOptions({
        target: 'ES2021',
        module: 'ESNext',
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      });
      expect(issues.length).toBe(0);
      expect(ok.length).toBe(4);
    });

    it('should handle non-string target', () => {
      const { issues } = checkRequiredTsOptions({
        target: 123,
        module: 'esnext',
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      });
      expect(issues.length).toBe(1);
    });
  });

  describe('runInit', () => {
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.clearAllMocks();
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it('should create tsconfig.json if not exists', async () => {
      (readJSON as jest.Mock).mockResolvedValue(null);

      await runInit('/test/dir');

      expect(writeJSON).toHaveBeenCalledWith(path.join('/test/dir', 'tsconfig.json'), RECOMMENDED_TSCONFIG);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Created tsconfig.json'));
    });

    it('should merge existing tsconfig.json with required options', async () => {
      const existing = {
        compilerOptions: {
          strict: true,
          outDir: 'build',
        },
        include: ['custom/**/*'],
      };
      (readJSON as jest.Mock).mockResolvedValue(existing);

      await runInit('/test/dir');

      expect(writeJSON).toHaveBeenCalledWith(
        path.join('/test/dir', 'tsconfig.json'),
        expect.objectContaining({
          compilerOptions: expect.objectContaining({
            target: 'es2021',
            module: 'esnext',
            emitDecoratorMetadata: true,
            experimentalDecorators: true,
            strict: true,
            outDir: 'build',
          }),
          include: ['custom/**/*'],
        }),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('verified and updated'));
    });

    it('should use process.cwd() if no baseDir provided', async () => {
      const originalCwd = process.cwd();
      (readJSON as jest.Mock).mockResolvedValue(null);

      await runInit();

      expect(writeJSON).toHaveBeenCalledWith(path.join(originalCwd, 'tsconfig.json'), RECOMMENDED_TSCONFIG);
    });
  });
});
