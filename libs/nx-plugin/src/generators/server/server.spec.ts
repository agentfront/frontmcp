import { readJson, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { appGenerator } from '../app/app';
import { serverGenerator } from './server';

describe('server generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should generate common server files', async () => {
    await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'node', skipFormat: true });

    expect(tree.exists('servers/prod/src/main.ts')).toBe(true);
    expect(tree.exists('servers/prod/project.json')).toBe(true);
    expect(tree.exists('servers/prod/tsconfig.json')).toBe(true);
    expect(tree.exists('servers/prod/tsconfig.lib.json')).toBe(true);
  });

  describe('node target', () => {
    it('should generate Docker files', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'node', skipFormat: true });

      expect(tree.exists('servers/prod/Dockerfile')).toBe(true);
      expect(tree.exists('servers/prod/docker-compose.yml')).toBe(true);
      expect(tree.exists('servers/prod/.dockerignore')).toBe(true);
    });

    it('should include redis service when redis=docker', async () => {
      await serverGenerator(tree, {
        name: 'prod',
        apps: 'demo',
        deploymentTarget: 'node',
        redis: 'docker',
        skipFormat: true,
      });

      const compose = tree.read('servers/prod/docker-compose.yml', 'utf-8');
      expect(compose).toContain('redis:');
      expect(compose).toContain('REDIS_HOST=redis');
    });
  });

  describe('vercel target', () => {
    it('should generate vercel.json', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'vercel', skipFormat: true });

      expect(tree.exists('servers/prod/vercel.json')).toBe(true);
      const vercelJson = readJson(tree, 'servers/prod/vercel.json');
      expect(vercelJson.version).toBe(2);
    });
  });

  describe('lambda target', () => {
    it('should generate SAM template', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'lambda', skipFormat: true });

      expect(tree.exists('servers/prod/template.yaml')).toBe(true);
      const template = tree.read('servers/prod/template.yaml', 'utf-8');
      expect(template).toContain('AWS::Serverless');
    });
  });

  describe('cloudflare target', () => {
    it('should generate wrangler.toml', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'cloudflare', skipFormat: true });

      expect(tree.exists('servers/prod/wrangler.toml')).toBe(true);
      const toml = tree.read('servers/prod/wrangler.toml', 'utf-8');
      expect(toml).toContain('server-prod');
      // main must point at the cloudflare build output (not dist/main.js), and
      // nodejs_compat is required or the deployed Worker can't boot.
      expect(toml).toContain('main = "dist/cloudflare/index.js"');
      expect(toml).toContain('compatibility_flags = ["nodejs_compat"]');
    });
  });

  it('should compose multiple apps', async () => {
    await serverGenerator(tree, { name: 'prod', apps: 'demo, auth', deploymentTarget: 'node' });

    const mainTs = tree.read('servers/prod/src/main.ts', 'utf-8');
    expect(mainTs).toContain('DemoApp');
    expect(mainTs).toContain('AuthApp');
  });

  it('should set deploy executor with correct target', async () => {
    await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'vercel', skipFormat: true });

    const projectJson = readJson(tree, 'servers/prod/project.json');
    expect(projectJson.targets.deploy.executor).toBe('@frontmcp/nx:deploy');
    expect(projectJson.targets.deploy.options.target).toBe('vercel');
  });

  it('should use custom directory when provided', async () => {
    await serverGenerator(tree, {
      name: 'prod',
      apps: 'demo',
      deploymentTarget: 'node',
      directory: 'deploy/prod',
      skipFormat: true,
    });

    expect(tree.exists('deploy/prod/src/main.ts')).toBe(true);
  });

  it('should use custom tags', async () => {
    await serverGenerator(tree, {
      name: 'prod',
      apps: 'demo',
      deploymentTarget: 'node',
      tags: 'env:prod, tier:1',
      skipFormat: true,
    });

    const projectJson = readJson(tree, 'servers/prod/project.json');
    expect(projectJson.tags).toContain('env:prod');
    expect(projectJson.tags).toContain('tier:1');
  });

  it('should export default', async () => {
    const mod = await import('./server');
    expect(mod.default).toBe(serverGenerator);
  });

  describe('project layout', () => {
    it('emits a package.json so `frontmcp build` can name the server', async () => {
      await serverGenerator(tree, { name: 'gateway', apps: 'demo', deploymentTarget: 'node', skipFormat: true });

      expect(readJson(tree, 'servers/gateway/package.json')).toMatchObject({ name: 'server-gateway', private: true });
    });

    it('imports the apps through their real project location', async () => {
      await appGenerator(tree, { name: 'demo', skipFormat: true });
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'node', skipFormat: true });

      const main = tree.read('servers/prod/src/main.ts', 'utf-8') ?? '';
      expect(main).toContain("from '../../../apps/demo/src/demo.app'");
      expect(main).not.toContain('../../apps/demo/demo.app');
    });

    it('never passes the unknown --adapter option to the build target', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'vercel', skipFormat: true });

      const { targets } = readJson(tree, 'servers/prod/project.json');
      expect(targets.build.options.adapter).toBeUndefined();
      expect(targets.build.options.target).toBe('vercel');
      expect(targets.build.cache).toBe(true);
    });

    it('extends the base tsconfig from any directory depth', async () => {
      await serverGenerator(tree, {
        name: 'prod',
        apps: 'demo',
        deploymentTarget: 'node',
        directory: 'servers/eu/prod',
        skipFormat: true,
      });

      expect(readJson(tree, 'servers/eu/prod/tsconfig.json').extends).toBe('../../../tsconfig.base.json');
    });
  });
});
