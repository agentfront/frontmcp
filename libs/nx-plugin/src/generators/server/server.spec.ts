import { readJson, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { getLambdaDependencies } from '../../utils/versions';
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
      // The build context is the workspace root, so Docker only reads an ignore file named after the Dockerfile.
      expect(tree.exists('servers/prod/Dockerfile.dockerignore')).toBe(true);
      expect(tree.exists('servers/prod/.dockerignore')).toBe(false);
      expect(tree.read('servers/prod/Dockerfile.dockerignore', 'utf-8')).toContain('**/node_modules');
    });

    it('runs the bundle the node build writes and listens on every interface', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'node', skipFormat: true });

      const dockerfile = tree.read('servers/prod/Dockerfile', 'utf-8') ?? '';
      expect(dockerfile).toContain('RUN npx nx build server-prod');
      expect(dockerfile).toContain('COPY --from=builder /app/servers/prod/dist ./dist');
      expect(dockerfile).toContain('CMD ["node", "dist/node/server-prod.bundle.js"]');
      expect(dockerfile).not.toContain('dist/main.js');
      expect(dockerfile).toContain('ENV FRONTMCP_BIND_ADDRESS=all');
    });

    // #726 — `npm ci` failed in yarn and pnpm workspaces, which have no package-lock.json
    it("installs and prunes with the workspace's package manager", async () => {
      tree.write('pnpm-lock.yaml', '');
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'node', skipFormat: true });

      const dockerfile = tree.read('servers/prod/Dockerfile', 'utf-8') ?? '';
      expect(dockerfile).toContain(
        'RUN corepack enable\nCOPY . .\nRUN pnpm install --frozen-lockfile --ignore-scripts',
      );
      expect(dockerfile).toContain('RUN pnpm exec nx build server-prod\nRUN pnpm prune --prod --ignore-scripts');
      expect(dockerfile).toContain('COPY --from=builder /app/node_modules ./node_modules');
      expect(dockerfile).not.toContain('npm ci');
    });

    it('makes Yarn Berry install into node_modules, which the runtime image copies', async () => {
      tree.write('yarn.lock', '');
      tree.write('.yarnrc.yml', 'yarnPath: .yarn/releases/yarn-4.14.1.cjs\n');
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'node', skipFormat: true });

      const dockerfile = tree.read('servers/prod/Dockerfile', 'utf-8') ?? '';
      expect(dockerfile).toContain(
        'RUN corepack enable\nENV YARN_NODE_LINKER=node-modules\nCOPY . .\nRUN yarn install --immutable --mode=skip-build',
      );
      expect(dockerfile).toContain('COPY --from=builder /app/node_modules ./node_modules');
    });

    it('needs no setup step for npm', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'node', skipFormat: true });

      const dockerfile = tree.read('servers/prod/Dockerfile', 'utf-8') ?? '';
      expect(dockerfile).toContain('WORKDIR /app\nCOPY . .\nRUN npm ci --ignore-scripts');
      expect(dockerfile).toContain('RUN npm prune --omit=dev');
    });

    it('points docker compose at the workspace root from any depth', async () => {
      await serverGenerator(tree, {
        name: 'prod',
        apps: 'demo',
        deploymentTarget: 'node',
        directory: 'servers/eu/prod',
        skipFormat: true,
      });

      const compose = tree.read('servers/eu/prod/docker-compose.yml', 'utf-8') ?? '';
      expect(compose).toContain('context: ../../../');
      expect(compose).toContain('dockerfile: servers/eu/prod/Dockerfile');
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

    it('builds the Build Output API tree with Nx instead of pointing at a dist/main.js the build never writes', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'vercel', skipFormat: true });

      const vercelJson = readJson(tree, 'servers/prod/vercel.json');
      expect(vercelJson).toEqual({
        $schema: 'https://openapi.vercel.sh/vercel.json',
        version: 2,
        installCommand: 'cd ../../ && npm install',
        buildCommand: 'cd ../../ && npx nx build server-prod',
      });
      expect(vercelJson.builds).toBeUndefined();
      expect(vercelJson.routes).toBeUndefined();
    });

    it('runs the workspace package manager', async () => {
      tree.write('pnpm-lock.yaml', '');
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'vercel', skipFormat: true });

      expect(readJson(tree, 'servers/prod/vercel.json')).toMatchObject({
        installCommand: 'cd ../../ && pnpm install',
        buildCommand: 'cd ../../ && pnpm exec nx build server-prod',
      });
    });

    it('caches the .vercel/output tree the build writes next to dist', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'vercel', skipFormat: true });

      expect(readJson(tree, 'servers/prod/project.json').targets.build.outputs).toEqual([
        '{projectRoot}/dist',
        '{projectRoot}/.vercel/output',
      ]);
    });
  });

  describe('lambda target', () => {
    it('should generate SAM template', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'lambda', skipFormat: true });

      expect(tree.exists('servers/prod/template.yaml')).toBe(true);
      const template = tree.read('servers/prod/template.yaml', 'utf-8');
      expect(template).toContain('AWS::Serverless');
    });

    it('installs the serverless-express wrapper the lambda build requires', async () => {
      const task = await serverGenerator(tree, {
        name: 'prod',
        apps: 'demo',
        deploymentTarget: 'lambda',
        skipFormat: true,
      });

      expect(typeof task).toBe('function');
      expect(readJson(tree, 'package.json').dependencies['@codegenie/serverless-express']).toBe(
        getLambdaDependencies()['@codegenie/serverless-express'],
      );
    });

    it('adds no dependencies for the other targets', async () => {
      const task = await serverGenerator(tree, {
        name: 'prod',
        apps: 'demo',
        deploymentTarget: 'node',
        skipFormat: true,
      });

      expect(task).toBeUndefined();
      expect(readJson(tree, 'package.json').dependencies?.['@codegenie/serverless-express']).toBeUndefined();
    });

    it('points SAM at the handler the lambda build writes (dist/lambda/handler.cjs)', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'lambda', skipFormat: true });

      const template = tree.read('servers/prod/template.yaml', 'utf-8') ?? '';
      expect(template).toContain('CodeUri: dist/lambda/');
      expect(template).toContain('Handler: handler.handler');
      expect(template).not.toContain('main.handler');
      expect(readJson(tree, 'servers/prod/project.json').targets.build.outputs).toEqual(['{projectRoot}/dist']);
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

    it('has a dev target that serves the composed apps', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'node', skipFormat: true });

      expect(readJson(tree, 'servers/prod/project.json').targets.dev).toEqual({
        executor: '@frontmcp/nx:dev',
        options: { entry: '{projectRoot}/src/main.ts' },
      });
    });

    it('type-checks with its own target instead of the inferred tsc --build one (TS5069)', async () => {
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'node', skipFormat: true });

      expect(readJson(tree, 'servers/prod/tsconfig.json').nx).toEqual({ addTypecheckTarget: false });
      expect(readJson(tree, 'servers/prod/project.json').targets.typecheck).toMatchObject({
        executor: 'nx:run-commands',
        options: { command: 'tsc --noEmit -p tsconfig.lib.json', cwd: '{projectRoot}' },
      });
    });

    it('compiles from the workspace root with JavaScript output in any workspace', async () => {
      tree.write('package.json', JSON.stringify({ devDependencies: { typescript: '~6.0.3' } }));
      await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'node', skipFormat: true });

      expect(readJson(tree, 'servers/prod/tsconfig.json').compilerOptions).toMatchObject({
        module: 'commonjs',
        moduleResolution: 'bundler',
        rootDir: '../../',
        composite: false,
        declarationMap: false,
        emitDeclarationOnly: false,
      });
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
