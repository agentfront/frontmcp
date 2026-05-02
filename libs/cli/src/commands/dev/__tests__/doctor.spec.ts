// file: libs/cli/src/commands/dev/__tests__/doctor.spec.ts

import { spawn } from 'child_process';
import * as path from 'path';

import { fileExists, readJSON } from '@frontmcp/utils';

import { resolveEntry } from '../../../shared/fs';
import { runDoctor } from '../doctor';

// Mock child_process
jest.mock('child_process', () => {
  const { EventEmitter } = require('events');
  return {
    spawn: jest.fn(() => {
      const emitter = new EventEmitter();
      emitter.stdout = new EventEmitter();
      return emitter;
    }),
  };
});

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => {
  return {
    fileExists: jest.fn(),
    readJSON: jest.fn(),
  };
});

// Mock utils/fs
jest.mock('../../../shared/fs', () => {
  return {
    resolveEntry: jest.fn(),
  };
});

// Helper to simulate npm version check
function mockNpmVersion(version: string) {
  const mockSpawn = spawn as jest.Mock;
  mockSpawn.mockImplementation(() => {
    const { EventEmitter } = require('events');
    const emitter = new EventEmitter();
    emitter.stdout = new EventEmitter();
    setTimeout(() => {
      emitter.stdout.emit('data', version);
      emitter.emit('close');
    }, 0);
    return emitter;
  });
}

function mockNpmError() {
  const mockSpawn = spawn as jest.Mock;
  mockSpawn.mockImplementation(() => {
    const { EventEmitter } = require('events');
    const emitter = new EventEmitter();
    emitter.stdout = new EventEmitter();
    setTimeout(() => {
      emitter.emit('error', new Error('npm not found'));
    }, 0);
    return emitter;
  });
}

describe('doctor command', () => {
  let consoleLogSpy: jest.SpyInstance;
  const originalVersions = process.versions;
  const cwd = process.cwd();

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    // Mock valid npm version
    mockNpmVersion('10.5.0');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    Object.defineProperty(process, 'versions', { value: originalVersions });
  });

  describe('runDoctor', () => {
    it('should pass with all requirements met', async () => {
      // Mock Node 22
      Object.defineProperty(process, 'versions', {
        value: { ...originalVersions, node: '22.0.0' },
        configurable: true,
      });

      (fileExists as jest.Mock).mockResolvedValue(true);
      (readJSON as jest.Mock).mockResolvedValue({
        compilerOptions: {
          target: 'es2021',
          module: 'esnext',
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
        },
      });
      (resolveEntry as jest.Mock).mockResolvedValue('/test/src/main.ts');

      await runDoctor();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✅'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('All checks passed'));
    });

    it('should fail with old Node version', async () => {
      Object.defineProperty(process, 'versions', {
        value: { ...originalVersions, node: '18.0.0' },
        configurable: true,
      });

      (fileExists as jest.Mock).mockResolvedValue(true);
      (readJSON as jest.Mock).mockResolvedValue({
        compilerOptions: {
          target: 'es2021',
          module: 'esnext',
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
        },
      });
      (resolveEntry as jest.Mock).mockResolvedValue('/test/src/main.ts');

      await runDoctor();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('❌ Node 18.0.0'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Some checks failed'));
    });

    it('should fail with old npm version', async () => {
      Object.defineProperty(process, 'versions', {
        value: { ...originalVersions, node: '22.0.0' },
        configurable: true,
      });

      mockNpmVersion('9.0.0');

      (fileExists as jest.Mock).mockResolvedValue(true);
      (readJSON as jest.Mock).mockResolvedValue({
        compilerOptions: {
          target: 'es2021',
          module: 'esnext',
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
        },
      });
      (resolveEntry as jest.Mock).mockResolvedValue('/test/src/main.ts');

      await runDoctor();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('❌ npm 9.0.0'));
    });

    it('should handle npm not found', async () => {
      Object.defineProperty(process, 'versions', {
        value: { ...originalVersions, node: '22.0.0' },
        configurable: true,
      });

      mockNpmError();

      (fileExists as jest.Mock).mockResolvedValue(true);
      (readJSON as jest.Mock).mockResolvedValue({
        compilerOptions: {
          target: 'es2021',
          module: 'esnext',
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
        },
      });
      (resolveEntry as jest.Mock).mockResolvedValue('/test/src/main.ts');

      await runDoctor();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('❌ npm not found'));
    });

    it('should fail if tsconfig.json not found', async () => {
      Object.defineProperty(process, 'versions', {
        value: { ...originalVersions, node: '22.0.0' },
        configurable: true,
      });

      (fileExists as jest.Mock).mockResolvedValue(false);
      (resolveEntry as jest.Mock).mockResolvedValue('/test/src/main.ts');

      await runDoctor();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('❌ tsconfig.json not found'));
    });

    it('should report tsconfig issues', async () => {
      Object.defineProperty(process, 'versions', {
        value: { ...originalVersions, node: '22.0.0' },
        configurable: true,
      });

      (fileExists as jest.Mock).mockResolvedValue(true);
      (readJSON as jest.Mock).mockResolvedValue({
        compilerOptions: {
          target: 'es5', // Wrong target
          module: 'commonjs', // Wrong module
          emitDecoratorMetadata: false,
          experimentalDecorators: false,
        },
      });
      (resolveEntry as jest.Mock).mockResolvedValue('/test/src/main.ts');

      await runDoctor();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('frontmcp init'));
    });

    it('should handle entry not found', async () => {
      Object.defineProperty(process, 'versions', {
        value: { ...originalVersions, node: '22.0.0' },
        configurable: true,
      });

      (fileExists as jest.Mock).mockResolvedValue(true);
      (readJSON as jest.Mock).mockResolvedValue({
        compilerOptions: {
          target: 'es2021',
          module: 'esnext',
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
        },
      });
      (resolveEntry as jest.Mock).mockRejectedValue(new Error('No entry file found'));

      await runDoctor();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('❌ entry not detected'));
    });

    it('should spawn npm without shell:true (no DEP0190)', async () => {
      // #381: doctor must not pass `shell: true` to spawn — it triggers
      // Node's DEP0190 deprecation warning every time the command runs.
      Object.defineProperty(process, 'versions', {
        value: { ...originalVersions, node: '22.0.0' },
        configurable: true,
      });
      (fileExists as jest.Mock).mockResolvedValue(true);
      (readJSON as jest.Mock).mockResolvedValue({
        compilerOptions: {
          target: 'es2021',
          module: 'esnext',
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
        },
      });
      (resolveEntry as jest.Mock).mockResolvedValue('/test/src/main.ts');

      await runDoctor();

      const calls = (spawn as jest.Mock).mock.calls;
      // First call is for npm version
      expect(calls[0][0]).toMatch(/^npm(\.cmd)?$/);
      expect(calls[0][1]).toEqual(['-v']);
      // Either no third arg, or third arg without shell:true
      const opts = calls[0][2] as { shell?: unknown } | undefined;
      if (opts) {
        expect(opts.shell).not.toBe(true);
      }
    });

    it('should show entry file path when found', async () => {
      Object.defineProperty(process, 'versions', {
        value: { ...originalVersions, node: '22.0.0' },
        configurable: true,
      });

      (fileExists as jest.Mock).mockResolvedValue(true);
      (readJSON as jest.Mock).mockResolvedValue({
        compilerOptions: {
          target: 'es2021',
          module: 'esnext',
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
        },
      });
      (resolveEntry as jest.Mock).mockResolvedValue(path.join(cwd, 'src', 'main.ts'));

      await runDoctor();

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✅ entry detected'));
    });
  });
});
