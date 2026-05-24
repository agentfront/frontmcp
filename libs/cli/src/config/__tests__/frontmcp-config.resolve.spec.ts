/**
 * resolveConfig() tests — issue #400.
 *
 * Covers:
 *   - explicit --config path
 *   - FRONTMCP_CONFIG env var
 *   - upward walk from cwd
 *   - env overlay composition (shared ⊕ <mode> ⊕ cli) with precedence
 *   - mode → env-overlay-key mapping
 *   - no-config-found graceful fallback
 */

import * as os from 'os';
import * as path from 'path';

import { mkdir, mkdtemp, writeFile } from '@frontmcp/utils';

import { resolveConfig } from '../frontmcp-config.resolve';

async function makeTempProject(filename: string, contents: string, subdir = ''): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-resolve-'));
  const target = subdir ? path.join(root, subdir) : root;
  if (subdir) await mkdir(target, { recursive: true });
  await writeFile(path.join(target, filename), contents);
  return root;
}

const MINIMAL_CONFIG_JSON = JSON.stringify({
  name: 'demo',
  deployments: [{ target: 'node' }],
  transport: { default: 'http', http: { port: 4321 } },
  env: {
    shared: { SHARED_KEY: 'shared_value' },
    dev: { DEV_KEY: 'dev_value' },
    test: { TEST_KEY: 'test_value' },
    ship: { SHIP_KEY: 'ship_value' },
  },
});

describe('resolveConfig (issue #400)', () => {
  describe('file resolution', () => {
    it('returns no config when none is present and no path is given', async () => {
      const empty = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-resolve-empty-'));
      const result = await resolveConfig({ cwd: empty, mode: 'dev' });
      expect(result.config).toBeUndefined();
      expect(result.configDir).toBeUndefined();
      expect(result.configPath).toBeUndefined();
    });

    it('loads explicit --config path', async () => {
      const root = await makeTempProject('custom.config.json', MINIMAL_CONFIG_JSON);
      const result = await resolveConfig({
        cwd: '/tmp', // intentionally different from root
        mode: 'dev',
        configPath: path.join(root, 'custom.config.json'),
      });
      expect(result.config?.name).toBe('demo');
      expect(result.configPath).toContain('custom.config.json');
    });

    it("throws when --config path doesn't exist", async () => {
      await expect(resolveConfig({ cwd: '/tmp', mode: 'dev', configPath: '/nonexistent/path.json' })).rejects.toThrow(
        /Config file not found/,
      );
    });

    it('reads FRONTMCP_CONFIG env var when no explicit path', async () => {
      const root = await makeTempProject('env.config.json', MINIMAL_CONFIG_JSON);
      const result = await resolveConfig({
        cwd: '/tmp',
        mode: 'dev',
        env: { FRONTMCP_CONFIG: path.join(root, 'env.config.json') },
      });
      expect(result.config?.name).toBe('demo');
    });

    it('explicit --config beats FRONTMCP_CONFIG env', async () => {
      const explicitRoot = await makeTempProject(
        'explicit.config.json',
        JSON.stringify({ name: 'explicit', deployments: [{ target: 'node' }] }),
      );
      const envRoot = await makeTempProject(
        'env.config.json',
        JSON.stringify({ name: 'from-env', deployments: [{ target: 'node' }] }),
      );
      const result = await resolveConfig({
        cwd: '/tmp',
        mode: 'dev',
        configPath: path.join(explicitRoot, 'explicit.config.json'),
        env: { FRONTMCP_CONFIG: path.join(envRoot, 'env.config.json') },
      });
      expect(result.config?.name).toBe('explicit');
    });

    it('walks upward from a nested cwd to find the parent config', async () => {
      // Place config at root, run from apps/a/b/c — upward walk should hit it.
      const root = await makeTempProject('frontmcp.config.json', MINIMAL_CONFIG_JSON);
      const nestedCwd = path.join(root, 'apps', 'a', 'b', 'c');
      await mkdir(nestedCwd, { recursive: true });
      const result = await resolveConfig({ cwd: nestedCwd, mode: 'dev' });
      expect(result.config?.name).toBe('demo');
      expect(result.configDir).toBe(root);
    });
  });

  describe('env overlay composition', () => {
    let root: string;
    beforeAll(async () => {
      root = await makeTempProject('frontmcp.config.json', MINIMAL_CONFIG_JSON);
    });

    it("applies shared ⊕ dev for mode='dev'", async () => {
      const result = await resolveConfig({ cwd: root, mode: 'dev', env: {} });
      expect(result.effectiveEnv['SHARED_KEY']).toBe('shared_value');
      expect(result.effectiveEnv['DEV_KEY']).toBe('dev_value');
      expect(result.effectiveEnv['TEST_KEY']).toBeUndefined();
      expect(result.effectiveEnv['SHIP_KEY']).toBeUndefined();
    });

    it("applies shared ⊕ test for mode='test'", async () => {
      const result = await resolveConfig({ cwd: root, mode: 'test', env: {} });
      expect(result.effectiveEnv['SHARED_KEY']).toBe('shared_value');
      expect(result.effectiveEnv['TEST_KEY']).toBe('test_value');
      expect(result.effectiveEnv['DEV_KEY']).toBeUndefined();
    });

    it("applies shared ⊕ ship for mode='pm:start'", async () => {
      const result = await resolveConfig({ cwd: root, mode: 'pm:start', env: {} });
      expect(result.effectiveEnv['SHARED_KEY']).toBe('shared_value');
      expect(result.effectiveEnv['SHIP_KEY']).toBe('ship_value');
    });

    it("applies only shared for mode='build:cli' (no mode-specific overlay)", async () => {
      const result = await resolveConfig({ cwd: root, mode: 'build:cli', env: {} });
      expect(result.effectiveEnv['SHARED_KEY']).toBe('shared_value');
      expect(result.effectiveEnv['DEV_KEY']).toBeUndefined();
      expect(result.effectiveEnv['TEST_KEY']).toBeUndefined();
      expect(result.effectiveEnv['SHIP_KEY']).toBeUndefined();
    });

    it('starts from process.env and lets the config overlay override', async () => {
      const result = await resolveConfig({
        cwd: root,
        mode: 'dev',
        env: { PRESERVED: 'from_process', SHARED_KEY: 'from_process_too' },
      });
      expect(result.effectiveEnv['PRESERVED']).toBe('from_process');
      // Config overlay wins over process.env for keys it owns
      expect(result.effectiveEnv['SHARED_KEY']).toBe('shared_value');
    });

    it('lets cliOptions.env beat both process.env and config overlays', async () => {
      const result = await resolveConfig({
        cwd: root,
        mode: 'dev',
        env: { SHARED_KEY: 'from_env' },
        cliOptions: { env: { SHARED_KEY: 'from_cli' } },
      });
      expect(result.effectiveEnv['SHARED_KEY']).toBe('from_cli');
    });
  });
});
