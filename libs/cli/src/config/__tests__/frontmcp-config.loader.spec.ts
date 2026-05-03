import * as os from 'os';
import * as path from 'path';

import { mkdtemp, rm, writeFile } from '@frontmcp/utils';

import {
  findDeployment,
  getDeploymentTargets,
  loadFrontMcpConfig,
  tryLoadFrontMcpConfig,
  validateConfig,
} from '../frontmcp-config.loader';

describe('validateConfig', () => {
  it('should validate and return parsed config', () => {
    const config = validateConfig({
      name: 'test-server',
      deployments: [{ target: 'node' }],
    });
    expect(config.name).toBe('test-server');
    expect(config.deployments).toHaveLength(1);
  });

  it('should throw on invalid config with readable message', () => {
    expect(() =>
      validateConfig({
        name: '',
        deployments: [],
      }),
    ).toThrow('Invalid frontmcp.config');
  });

  it('should preserve server config with http inside deployment', () => {
    const config = validateConfig({
      name: 'test',
      deployments: [
        {
          target: 'distributed',
          server: { http: { port: 8080 }, cookies: { affinity: '__myapp' } },
        },
      ],
    });
    const deployment = config.deployments[0] as {
      server?: { http?: { port?: number }; cookies?: { affinity?: string } };
    };
    expect(deployment.server?.http?.port).toBe(8080);
    expect(deployment.server?.cookies?.affinity).toBe('__myapp');
  });

  it('should allow browser deployment without server config', () => {
    const config = validateConfig({
      name: 'test',
      deployments: [{ target: 'browser' }],
    });
    expect(config.deployments[0].target).toBe('browser');
    expect((config.deployments[0] as Record<string, unknown>)['server']).toBeUndefined();
  });
});

describe('findDeployment', () => {
  const config = validateConfig({
    name: 'test',
    deployments: [{ target: 'distributed' }, { target: 'cli' }, { target: 'browser' }],
  });

  it('should find existing target', () => {
    expect(findDeployment(config, 'cli')?.target).toBe('cli');
  });

  it('should return undefined for missing target', () => {
    expect(findDeployment(config, 'vercel')).toBeUndefined();
  });
});

describe('getDeploymentTargets', () => {
  it('should return all target types', () => {
    const config = validateConfig({
      name: 'test',
      deployments: [{ target: 'distributed' }, { target: 'cli' }, { target: 'browser' }],
    });
    expect(getDeploymentTargets(config)).toEqual(['distributed', 'cli', 'browser']);
  });
});

// #365 — when the project is `"type": "commonjs"`, the loader used to fail
// silently on `frontmcp.config.ts` (Node can't `require` a TS file without
// a hook, and `import()` errors out on the type mismatch) and the build
// proceeded with default values. Now the loader uses esbuild as a last
// resort and hard-fails on transpile errors.
describe('loadFrontMcpConfig: TS config under "type": "commonjs" (#365)', () => {
  async function makeProject(tsConfigSource: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-loader-'));
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', type: 'commonjs' }));
    await writeFile(path.join(dir, 'frontmcp.config.ts'), tsConfigSource);
    return dir;
  }

  it('loads a TS config under type:commonjs via esbuild fallback', async () => {
    const dir = await makeProject(`
const config: { name: string; nodeVersion: string; deployments: Array<{target: string}> } = {
  name: 'cjs-loaded',
  nodeVersion: '>=24.0.0',
  deployments: [{ target: 'node' }],
};
export default config;
`);
    try {
      const cfg = await loadFrontMcpConfig(dir);
      expect(cfg.name).toBe('cjs-loaded');
      expect(cfg.nodeVersion).toBe('>=24.0.0');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('hard-fails when the TS config has a syntax error (no silent default)', async () => {
    const dir = await makeProject(`this is not valid typescript {{{`);
    try {
      await expect(loadFrontMcpConfig(dir)).rejects.toThrow(/Failed to load frontmcp\.config\.ts/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('round-2: does not emit Node\'s "Failed to load the ES module" warning for .ts under CJS (#365)', async () => {
    // Round 1 left the loader trying `await import()` after `require()` failed,
    // which causes Node to print
    //   Warning: Failed to load the ES module: ... Make sure to set "type":
    //   "module" in the nearest package.json file or use the .mjs extension.
    // The build proceeded via esbuild but the warning still leaked to stderr,
    // making retesters believe the config wasn't loaded. Round 2 detects
    // CJS and skips Node's `await import()` entirely.
    const dir = await makeProject(`
const config: { name: string; deployments: Array<{target: string}> } = {
  name: 'cjs-no-warn',
  deployments: [{ target: 'node' }],
};
export default config;
`);
    const originalEmit = process.emitWarning;
    const warnings: string[] = [];
    process.emitWarning = ((msg: string | Error) => {
      warnings.push(typeof msg === 'string' ? msg : msg.message);
    }) as typeof process.emitWarning;
    try {
      const cfg = await loadFrontMcpConfig(dir);
      expect(cfg.name).toBe('cjs-no-warn');
      const esmWarnings = warnings.filter((w) => /Failed to load the ES module/i.test(w));
      expect(esmWarnings).toEqual([]);
    } finally {
      process.emitWarning = originalEmit;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('bundles sibling-helper imports so multi-file configs work under CJS', async () => {
    // CR3 — `transformSync` only transpiles the entry; `esbuild.build` with
    // `bundle: true` inlines `import { foo } from './helpers'` so the output
    // doesn't emit unresolvable `require('./helpers')` under "type": "commonjs".
    const dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-loader-multi-'));
    try {
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', type: 'commonjs' }));
      await writeFile(path.join(dir, 'helpers.ts'), `export const HELPER_NAME: string = 'multi-loaded';\n`);
      await writeFile(
        path.join(dir, 'frontmcp.config.ts'),
        `import { HELPER_NAME } from './helpers';
const config: { name: string; deployments: Array<{target: string}> } = {
  name: HELPER_NAME,
  deployments: [{ target: 'node' }],
};
export default config;
`,
      );
      const cfg = await loadFrontMcpConfig(dir);
      expect(cfg.name).toBe('multi-loaded');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Regression — `runBuild` previously hard-failed when the user had a legacy
// `frontmcp.config.js` (top-level `cli`/`sea`/`esbuild`, no `deployments`).
// `tryLoadFrontMcpConfig` returns undefined for legacy shapes so the exec
// build can pick the file up via its own loader.
describe('tryLoadFrontMcpConfig — legacy shape recovery', () => {
  async function makeJsProject(jsConfigSource: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-loader-legacy-'));
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', type: 'commonjs' }));
    await writeFile(path.join(dir, 'frontmcp.config.js'), jsConfigSource);
    return dir;
  }

  it('returns undefined for legacy top-level `cli`/`sea`/`esbuild` shape', async () => {
    const dir = await makeJsProject(`module.exports = {
      name: 'demo', version: '1.0.0', entry: './src/main.ts',
      esbuild: { external: [] }, sea: { enabled: false },
      cli: { enabled: true, outputDefault: 'text' },
    };`);
    try {
      const cfg = await tryLoadFrontMcpConfig(dir);
      // No `deployments` field → not a v1.1 config; downstream exec-loader
      // handles it from disk directly.
      expect(cfg).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined when no config file is present', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-loader-empty-'));
    try {
      // No frontmcp.config.* and no package.json → undefined, no throw.
      const cfg = await tryLoadFrontMcpConfig(dir);
      expect(cfg).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('still hard-fails when the file exists but cannot be parsed', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-loader-bad-'));
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', type: 'commonjs' }));
    await writeFile(path.join(dir, 'frontmcp.config.ts'), 'this is not valid typescript {{{');
    try {
      await expect(tryLoadFrontMcpConfig(dir)).rejects.toThrow(/Failed to load frontmcp\.config\.ts/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when a v1.1 config is malformed (not silently undefined)', async () => {
    // Round-3 CR — only legacy exec-only shapes (top-level cli/sea/esbuild
    // without deployments) get the silent-undefined fallback. A config that
    // *looks* v1.1 (has `deployments` or no exec-only marker fields) but is
    // malformed must throw, not silently fall back to defaults.
    const dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-loader-malformed-'));
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
    await writeFile(
      path.join(dir, 'frontmcp.config.json'),
      JSON.stringify({ name: 'demo', deployments: 'not-an-array' }),
    );
    try {
      await expect(tryLoadFrontMcpConfig(dir)).rejects.toThrow(/Invalid frontmcp\.config/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns parsed config when the new-shape schema matches', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-loader-newshape-'));
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
    await writeFile(
      path.join(dir, 'frontmcp.config.json'),
      JSON.stringify({ name: 'demo', deployments: [{ target: 'node' }] }),
    );
    try {
      const cfg = await tryLoadFrontMcpConfig(dir);
      expect(cfg?.name).toBe('demo');
      expect(cfg?.deployments).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
