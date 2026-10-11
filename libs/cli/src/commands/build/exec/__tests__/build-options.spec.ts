import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockEsbuildBuild = jest.fn(async (options: { outfile: string }) => {
  fs.writeFileSync(options.outfile, '');
  return {};
});
jest.mock('esbuild', () => ({ build: mockEsbuildBuild }), { virtual: true });

import { bundleCliWithEsbuild } from '../cli-runtime/cli-bundler';
import { loadExecConfig, normalizeConfig } from '../config';
import { bundleWithEsbuild } from '../esbuild-bundler';

describe('frontmcp.config build.esbuild / build.dependencies reach esbuild', () => {
  let projectDir: string;

  beforeEach(() => {
    mockEsbuildBuild.mockClear();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-build-options-'));
    fs.writeFileSync(
      path.join(projectDir, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'build-options-demo',
        deployments: [{ target: 'node' }, { target: 'cli' }],
        build: {
          esbuild: {
            external: ['left-external'],
            define: { 'process.env.BUILD_FLAVOR': '"configured"' },
            target: 'node24',
            minify: true,
          },
          dependencies: { nativeAddons: ['better-sqlite3-multiple-ciphers'], system: ['ffmpeg'] },
          network: { defaultPort: 4567 },
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function loadConfig() {
    return normalizeConfig(await loadExecConfig(projectDir));
  }

  it('passes external, define, target, minify and nativeAddons to the server bundle', async () => {
    await bundleWithEsbuild(path.join(projectDir, 'main.js'), projectDir, await loadConfig());
    const buildOptions = mockEsbuildBuild.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(buildOptions['external']).toEqual(
      expect.arrayContaining(['left-external', 'better-sqlite3-multiple-ciphers']),
    );
    expect(buildOptions['define']).toEqual({ 'process.env.BUILD_FLAVOR': '"configured"' });
    expect(buildOptions['target']).toBe('node24');
    expect(buildOptions['minify']).toBe(true);
  });

  it('passes the same options to the CLI bundle', async () => {
    await bundleCliWithEsbuild(path.join(projectDir, 'cli-entry.js'), projectDir, await loadConfig());
    const buildOptions = mockEsbuildBuild.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(buildOptions['external']).toEqual(
      expect.arrayContaining(['left-external', 'better-sqlite3-multiple-ciphers']),
    );
    expect(buildOptions['define']).toEqual({ 'process.env.BUILD_FLAVOR': '"configured"' });
    expect(buildOptions['target']).toBe('node24');
    expect(buildOptions['minify']).toBe(true);
  });

  it('keeps nativeAddons external in a self-contained bundle and applies define/target/minify', async () => {
    await bundleWithEsbuild(path.join(projectDir, 'main.js'), projectDir, await loadConfig(), { selfContained: true });
    const buildOptions = mockEsbuildBuild.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(buildOptions['external']).toEqual(expect.arrayContaining(['better-sqlite3-multiple-ciphers']));
    expect(buildOptions['define']).toEqual({ 'process.env.BUILD_FLAVOR': '"configured"' });
    expect(buildOptions['target']).toBe('node24');
  });

  it('carries build.dependencies.system and build.network into the exec config', async () => {
    const config = await loadConfig();
    expect(config.dependencies?.system).toEqual(['ffmpeg']);
    expect(config.network?.defaultPort).toBe(4567);
  });
});
