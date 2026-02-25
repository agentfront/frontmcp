import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, readJson } from '@nx/devkit';
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
});
