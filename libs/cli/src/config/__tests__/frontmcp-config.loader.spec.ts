import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { findDeployment, getDeploymentTargets, loadFrontMcpConfig, validateConfig } from '../frontmcp-config.loader';

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
  function makeProject(tsConfigSource: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-loader-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', type: 'commonjs' }));
    fs.writeFileSync(path.join(dir, 'frontmcp.config.ts'), tsConfigSource);
    return dir;
  }

  it('loads a TS config under type:commonjs via esbuild fallback', async () => {
    const dir = makeProject(`
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
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hard-fails when the TS config has a syntax error (no silent default)', async () => {
    const dir = makeProject(`this is not valid typescript {{{`);
    try {
      await expect(loadFrontMcpConfig(dir)).rejects.toThrow(/Failed to load frontmcp\.config\.ts/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
