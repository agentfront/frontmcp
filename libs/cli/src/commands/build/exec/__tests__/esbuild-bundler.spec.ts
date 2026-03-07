import * as path from 'path';
import { FrontmcpExecConfig } from '../config';

const mockBuild = jest.fn().mockResolvedValue({});
jest.mock('esbuild', () => ({ build: mockBuild }), { virtual: true });

const mockStatSync = jest.fn().mockReturnValue({ size: 12345 });
jest.mock('fs', () => ({ statSync: mockStatSync }));

import { bundleWithEsbuild, formatSize } from '../esbuild-bundler';

beforeEach(() => {
  jest.clearAllMocks();
  mockBuild.mockResolvedValue({});
  mockStatSync.mockReturnValue({ size: 12345 });
});

describe('bundleWithEsbuild', () => {
  const defaultConfig: FrontmcpExecConfig = {
    name: 'my-app',
    version: '1.0.0',
  };

  it('should call esbuild.build with entry, outfile, platform, format, bundle', async () => {
    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', defaultConfig);

    expect(mockBuild).toHaveBeenCalledTimes(1);
    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.entryPoints).toEqual(['/tmp/entry.js']);
    expect(buildArgs.outfile).toBe(path.join('/tmp/out', 'my-app.bundle.js'));
    expect(buildArgs.platform).toBe('node');
    expect(buildArgs.format).toBe('cjs');
    expect(buildArgs.bundle).toBe(true);
  });

  it('should use outputName for bundle filename when provided', async () => {
    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', defaultConfig, { outputName: 'custom-name' });

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.outfile).toBe(path.join('/tmp/out', 'custom-name.bundle.js'));
  });

  it('should default target to node22', async () => {
    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', defaultConfig);

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.target).toBe('node22');
  });

  it('should respect config.esbuild.target', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      esbuild: { target: 'node18' },
    };

    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', config);

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.target).toBe('node18');
  });

  it('should include DEFAULT_EXTERNALS + nativeAddons + esbuild.external in non-selfContained mode', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      dependencies: { nativeAddons: ['sharp'] },
      esbuild: { external: ['custom-pkg'] },
    };

    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', config);

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.external).toContain('better-sqlite3');
    expect(buildArgs.external).toContain('fsevents');
    expect(buildArgs.external).toContain('@swc/core');
    expect(buildArgs.external).toContain('esbuild');
    expect(buildArgs.external).toContain('sharp');
    expect(buildArgs.external).toContain('custom-pkg');
  });

  it('should omit config.esbuild.external in selfContained mode', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      dependencies: { nativeAddons: ['sharp'] },
      esbuild: { external: ['custom-pkg'] },
    };

    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', config, { selfContained: true });

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.external).toContain('better-sqlite3');
    expect(buildArgs.external).toContain('fsevents');
    expect(buildArgs.external).toContain('sharp');
    expect(buildArgs.external).not.toContain('custom-pkg');
  });

  it('should respect minify option from config', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      esbuild: { minify: true },
    };

    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', config);

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.minify).toBe(true);
  });

  it('should default minify to false when not configured', async () => {
    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', defaultConfig);

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.minify).toBe(false);
  });

  it('should respect define option from config', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      esbuild: { define: { 'process.env.NODE_ENV': '"production"' } },
    };

    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', config);

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.define).toEqual({ 'process.env.NODE_ENV': '"production"' });
  });

  it('should return bundlePath and bundleSize from statSync', async () => {
    mockStatSync.mockReturnValue({ size: 99999 });

    const result = await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', defaultConfig);

    expect(result.bundlePath).toBe(path.join('/tmp/out', 'my-app.bundle.js'));
    expect(result.bundleSize).toBe(99999);
  });

  it('should enable keepNames and treeShaking', async () => {
    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', defaultConfig);

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.keepNames).toBe(true);
    expect(buildArgs.treeShaking).toBe(true);
  });

  it('should set metafile to true and logLevel to warning', async () => {
    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', defaultConfig);

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.metafile).toBe(true);
    expect(buildArgs.logLevel).toBe('warning');
  });

  it('should disable sourcemap', async () => {
    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', defaultConfig);

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.sourcemap).toBe(false);
  });

  it('should handle nativeAddons without esbuild.external', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      dependencies: { nativeAddons: ['canvas'] },
    };

    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', config);

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.external).toContain('canvas');
  });

  it('should handle dependencies object without nativeAddons', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      dependencies: {},
    };

    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', config);

    const buildArgs = mockBuild.mock.calls[0][0];
    // Should still include DEFAULT_EXTERNALS
    expect(buildArgs.external).toContain('better-sqlite3');
    expect(buildArgs.external).toContain('esbuild');
  });

  it('should handle selfContained with no dependencies at all', async () => {
    await bundleWithEsbuild('/tmp/entry.js', '/tmp/out', defaultConfig, { selfContained: true });

    const buildArgs = mockBuild.mock.calls[0][0];
    expect(buildArgs.external).toContain('better-sqlite3');
    expect(buildArgs.external).not.toContain(undefined);
  });
});

describe('formatSize', () => {
  it('should format bytes', () => {
    expect(formatSize(500)).toBe('500 B');
  });

  it('should format zero bytes', () => {
    expect(formatSize(0)).toBe('0 B');
  });

  it('should format exactly 1024 bytes as KB', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
  });

  it('should format kilobytes', () => {
    expect(formatSize(2048)).toBe('2.0 KB');
  });

  it('should format exactly 1 MB', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('should format megabytes', () => {
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('bundleWithEsbuild - esbuild not installed', () => {
  it('should throw when esbuild is not installed', async () => {
    jest.resetModules();
    jest.doMock('esbuild', () => { throw new Error('Cannot find module'); }, { virtual: true });

    const mod = require('../esbuild-bundler');

    await expect(mod.bundleWithEsbuild('/tmp/entry.js', '/tmp/out', { name: 'test' }))
      .rejects.toThrow('esbuild is required');
  });
});
