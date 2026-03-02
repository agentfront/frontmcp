import * as path from 'path';
import { FrontmcpExecConfig } from '../config';

// Mock esbuild
const mockEsbuildBuild = jest.fn().mockResolvedValue({});
jest.mock('esbuild', () => ({
  build: mockEsbuildBuild,
}), { virtual: true });

// Mock fs.statSync for bundle size
const mockStatSync = jest.fn().mockReturnValue({ size: 12345 });
jest.mock('fs', () => ({
  statSync: mockStatSync,
}));

import { bundleCliWithEsbuild } from '../cli-runtime/cli-bundler';

beforeEach(() => {
  jest.clearAllMocks();
  mockEsbuildBuild.mockResolvedValue({});
  mockStatSync.mockReturnValue({ size: 12345 });
});

describe('bundleCliWithEsbuild', () => {
  const defaultConfig: FrontmcpExecConfig = {
    name: 'my-app',
    version: '1.0.0',
  };

  it('should call esbuild.build() with correct entry and outfile', async () => {
    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', defaultConfig);

    expect(mockEsbuildBuild).toHaveBeenCalledTimes(1);
    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.entryPoints).toEqual(['/tmp/cli-entry.js']);
    expect(buildArgs.outfile).toBe(path.join('/tmp/out', 'my-app-cli.bundle.js'));
  });

  it('should use CJS format and node platform', async () => {
    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', defaultConfig);

    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.platform).toBe('node');
    expect(buildArgs.format).toBe('cjs');
    expect(buildArgs.bundle).toBe(true);
  });

  it('should externalize the server bundle', async () => {
    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', defaultConfig);

    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.external).toContain('./my-app.bundle.js');
  });

  it('should externalize @frontmcp/sdk and native addons', async () => {
    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', defaultConfig);

    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.external).toContain('@frontmcp/sdk');
    expect(buildArgs.external).toContain('better-sqlite3');
    expect(buildArgs.external).toContain('fsevents');
  });

  it('should include custom externals from config.esbuild.external', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      esbuild: { external: ['custom-native-module'] },
    };

    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', config);

    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.external).toContain('custom-native-module');
  });

  it('should include custom native addons from config.dependencies.nativeAddons', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      dependencies: { nativeAddons: ['sharp', 'canvas'] },
    };

    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', config);

    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.external).toContain('sharp');
    expect(buildArgs.external).toContain('canvas');
  });

  it('should add #!/usr/bin/env node banner', async () => {
    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', defaultConfig);

    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.banner).toEqual({ js: '#!/usr/bin/env node' });
  });

  it('should use custom target from config', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      esbuild: { target: 'node18' },
    };

    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', config);

    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.target).toBe('node18');
  });

  it('should default target to node22', async () => {
    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', defaultConfig);

    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.target).toBe('node22');
  });

  it('should return bundlePath and bundleSize', async () => {
    mockStatSync.mockReturnValue({ size: 98765 });

    const result = await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', defaultConfig);

    expect(result.bundlePath).toBe(path.join('/tmp/out', 'my-app-cli.bundle.js'));
    expect(result.bundleSize).toBe(98765);
  });

  it('should enable tree shaking and disable sourcemap', async () => {
    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', defaultConfig);

    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.treeShaking).toBe(true);
    expect(buildArgs.sourcemap).toBe(false);
  });

  it('should respect config minify option', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      esbuild: { minify: true },
    };

    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', config);

    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.minify).toBe(true);
  });

  it('should pass config define options', async () => {
    const config: FrontmcpExecConfig = {
      ...defaultConfig,
      esbuild: { define: { 'process.env.NODE_ENV': '"production"' } },
    };

    await bundleCliWithEsbuild('/tmp/cli-entry.js', '/tmp/out', config);

    const buildArgs = mockEsbuildBuild.mock.calls[0][0];
    expect(buildArgs.define).toEqual({ 'process.env.NODE_ENV': '"production"' });
  });
});
