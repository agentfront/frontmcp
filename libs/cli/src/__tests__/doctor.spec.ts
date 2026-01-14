// file: libs/cli/src/__tests__/doctor.spec.ts

import * as path from 'path';

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
jest.mock('../utils/fs', () => {
  return {
    resolveEntry: jest.fn(),
  };
});

import { spawn } from 'child_process';
import { fileExists, readJSON } from '@frontmcp/utils';
import { resolveEntry } from '../utils/fs.js';
import { runDoctor } from '../commands/doctor.js';

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
