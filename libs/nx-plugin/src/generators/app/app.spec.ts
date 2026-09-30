import { readJson, updateJson, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { appGenerator } from './app';

describe('app generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should generate app files in apps/<name>/', async () => {
    await appGenerator(tree, { name: 'demo', skipFormat: true });

    expect(tree.exists('apps/demo/src/main.ts')).toBe(true);
    expect(tree.exists('apps/demo/src/demo.app.ts')).toBe(true);
    expect(tree.exists('apps/demo/src/tools/hello.tool.ts')).toBe(true);
    expect(tree.exists('apps/demo/project.json')).toBe(true);
    expect(tree.exists('apps/demo/tsconfig.json')).toBe(true);
    expect(tree.exists('apps/demo/tsconfig.lib.json')).toBe(true);
    expect(tree.exists('apps/demo/tsconfig.spec.json')).toBe(true);
    expect(tree.exists('apps/demo/jest.config.cjs')).toBe(true);
  });

  it('should use custom directory when provided', async () => {
    await appGenerator(tree, { name: 'demo', directory: 'custom/path/demo', skipFormat: true });

    expect(tree.exists('custom/path/demo/src/main.ts')).toBe(true);
    expect(tree.exists('custom/path/demo/project.json')).toBe(true);
  });

  it('should set correct project name in project.json', async () => {
    await appGenerator(tree, { name: 'my-app', skipFormat: true });

    const projectJson = readJson(tree, 'apps/my-app/project.json');
    expect(projectJson.name).toBe('my-app');
    expect(projectJson.projectType).toBe('application');
  });

  it('should include FrontMCP executors in project.json', async () => {
    await appGenerator(tree, { name: 'demo', skipFormat: true });

    const projectJson = readJson(tree, 'apps/demo/project.json');
    expect(projectJson.targets.build.executor).toBe('@frontmcp/nx:build');
    expect(projectJson.targets.dev.executor).toBe('@frontmcp/nx:dev');
    expect(projectJson.targets.serve.executor).toBe('@frontmcp/nx:serve');
    expect(projectJson.targets.test.executor).toBe('@frontmcp/nx:test');
    expect(projectJson.targets.inspector.executor).toBe('@frontmcp/nx:inspector');
  });

  it('should generate main.ts with correct class name', async () => {
    await appGenerator(tree, { name: 'my-app' });

    const mainContent = tree.read('apps/my-app/src/main.ts', 'utf-8');
    expect(mainContent).toContain("import { MyAppApp } from './my-app.app'");
    expect(mainContent).toContain('apps: [MyAppApp]');
  });

  it('should parse tags correctly', async () => {
    await appGenerator(tree, { name: 'demo', tags: 'scope:apps, type:demo', skipFormat: true });

    const projectJson = readJson(tree, 'apps/demo/project.json');
    expect(projectJson.tags).toContain('scope:apps');
    expect(projectJson.tags).toContain('type:demo');
  });

  it('should export default', async () => {
    const mod = await import('./app');
    expect(mod.default).toBe(appGenerator);
  });

  describe('project layout', () => {
    it('emits a package.json so `frontmcp build` can name the project', async () => {
      await appGenerator(tree, { name: 'demo', skipFormat: true });

      expect(readJson(tree, 'apps/demo/package.json')).toMatchObject({ name: 'demo', private: true });
    });

    it('maps tsconfig path aliases in the jest config from the right depth', async () => {
      await appGenerator(tree, { name: 'deep', directory: 'apps/team/deep', skipFormat: true });

      const jestConfig = tree.read('apps/team/deep/jest.config.cjs', 'utf-8') ?? '';
      expect(jestConfig).toContain("join(__dirname, '../../../')");
      expect(jestConfig).toContain('moduleNameMapper');
    });

    it('sets sourceRoot relative to the workspace, without the scaffold folder', async () => {
      await appGenerator(tree, {
        name: 'demo',
        directory: 'my-project/apps/demo',
        workspaceRoot: 'my-project',
        skipFormat: true,
      });

      const projectJson = readJson(tree, 'my-project/apps/demo/project.json');
      expect(projectJson.sourceRoot).toBe('apps/demo/src');
      expect(projectJson.$schema).toBe('../../node_modules/nx/schemas/project-schema.json');
    });

    it('extends the base tsconfig from any directory depth', async () => {
      await appGenerator(tree, { name: 'deep', directory: 'apps/team/platform/deep', skipFormat: true });

      expect(readJson(tree, 'apps/team/platform/deep/tsconfig.json').extends).toBe('../../../../tsconfig.base.json');
      expect(readJson(tree, 'apps/team/platform/deep/project.json').$schema).toBe(
        '../../../../node_modules/nx/schemas/project-schema.json',
      );
    });

    it('generates self-consistent compiler options so the CLI build does not hit TS5110', async () => {
      await appGenerator(tree, { name: 'demo', skipFormat: true });

      const { compilerOptions } = readJson(tree, 'apps/demo/tsconfig.json');
      expect(compilerOptions.module).toBe('commonjs');
      expect(compilerOptions.moduleResolution).toBe('node10');
      expect(compilerOptions.experimentalDecorators).toBe(true);
      expect(compilerOptions.emitDecoratorMetadata).toBe(true);
      expect(compilerOptions.rootDir).toBeUndefined();
    });

    it('acknowledges the node10 deprecation on TypeScript 6 workspaces only', async () => {
      await appGenerator(tree, { name: 'ts5', skipFormat: true });
      expect(readJson(tree, 'apps/ts5/tsconfig.json').compilerOptions.ignoreDeprecations).toBeUndefined();

      updateJson(tree, 'package.json', (json) => ({
        ...json,
        devDependencies: { ...json.devDependencies, typescript: '~6.0.3' },
      }));
      await appGenerator(tree, { name: 'ts6', skipFormat: true });
      expect(readJson(tree, 'apps/ts6/tsconfig.json').compilerOptions.ignoreDeprecations).toBe('6.0');
    });

    it('makes build and test cacheable', async () => {
      await appGenerator(tree, { name: 'demo', skipFormat: true });

      const { targets } = readJson(tree, 'apps/demo/project.json');
      expect(targets.build.cache).toBe(true);
      expect(targets.test.cache).toBe(true);
      expect(targets.dev.cache).toBeUndefined();
    });

    it('generates a jest config that loads the FrontMCP test setup and needs no missing preset', async () => {
      await appGenerator(tree, { name: 'demo', skipFormat: true });

      const config = tree.read('apps/demo/jest.config.cjs', 'utf-8') ?? '';
      expect(config).toContain('@frontmcp/testing/setup');
      expect(config).not.toContain('jest.preset');
      expect(tree.exists('apps/demo/jest.config.ts')).toBe(false);
    });
  });
});
