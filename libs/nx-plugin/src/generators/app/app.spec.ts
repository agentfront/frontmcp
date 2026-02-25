import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, readJson } from '@nx/devkit';
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
    expect(tree.exists('apps/demo/jest.config.ts')).toBe(true);
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
});
