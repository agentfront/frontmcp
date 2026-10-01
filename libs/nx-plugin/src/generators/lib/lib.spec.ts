import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, readJson } from '@nx/devkit';
import { adapterGenerator } from '../adapter/adapter';
import { appGenerator } from '../app/app';
import { pluginGenerator } from '../plugin/plugin';
import { libGenerator } from './lib';

describe('lib generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    // Create tsconfig.base.json for path mapping tests
    tree.write(
      'tsconfig.base.json',
      JSON.stringify({ compilerOptions: { paths: {} } }),
    );
  });

  describe('generic library', () => {
    it('should generate a generic library', async () => {
      await libGenerator(tree, { name: 'my-lib', skipFormat: true });

      expect(tree.exists('libs/my-lib/src/index.ts')).toBe(true);
      expect(tree.exists('libs/my-lib/src/my-lib.ts')).toBe(true);
      expect(tree.exists('libs/my-lib/project.json')).toBe(true);
    });

    it('should add path mapping to tsconfig.base.json', async () => {
      await libGenerator(tree, { name: 'my-lib', skipFormat: true });

      const tsconfig = readJson(tree, 'tsconfig.base.json');
      // ./-relative, or TypeScript rejects it in workspaces without a baseUrl (TS5090).
      expect(tsconfig.compilerOptions.paths['@frontmcp/my-lib']).toEqual([
        './libs/my-lib/src/index.ts',
      ]);
    });
  });

  describe('plugin library', () => {
    it('should generate a plugin library', async () => {
      await libGenerator(tree, { name: 'my-cache', libType: 'plugin', skipFormat: true });

      expect(tree.exists('libs/my-cache/src/index.ts')).toBe(true);
      expect(tree.exists('libs/my-cache/src/my-cache.plugin.ts')).toBe(true);

      const content = tree.read('libs/my-cache/src/my-cache.plugin.ts', 'utf-8');
      expect(content).toContain('@Plugin(');
      expect(content).toContain('extends DynamicPlugin');
    });
  });

  describe('plugin and adapter classes', () => {
    // #679: the lib templates had their own copies of these classes, which imported types the SDK
    // does not export (TS2614) and missed the adapter's abstract `options` (TS2515).
    it('is the class the plugin generator writes, without the opt-in context extension', async () => {
      await libGenerator(tree, { name: 'my-cache', libType: 'plugin', skipFormat: true });
      await appGenerator(tree, { name: 'demo', skipFormat: true });
      await pluginGenerator(tree, { name: 'my-cache', project: 'demo', skipFormat: true });

      expect(tree.read('libs/my-cache/src/my-cache.plugin.ts', 'utf-8')).toBe(
        tree.read('apps/demo/src/plugins/my-cache.plugin.ts', 'utf-8'),
      );
      expect(tree.read('libs/my-cache/src/my-cache.plugin.ts', 'utf-8')).not.toContain('PluginRegistrationContext');
      expect(tree.exists('libs/my-cache/src/my-cache.context-extension.ts')).toBe(false);
    });

    it('is the class the adapter generator writes', async () => {
      await libGenerator(tree, { name: 'openapi', libType: 'adapter', skipFormat: true });
      await appGenerator(tree, { name: 'demo', skipFormat: true });
      await adapterGenerator(tree, { name: 'openapi', project: 'demo', skipFormat: true });

      const content = tree.read('libs/openapi/src/openapi.adapter.ts', 'utf-8') ?? '';
      expect(content).toBe(tree.read('apps/demo/src/adapters/openapi.adapter.ts', 'utf-8'));
      expect(content).not.toContain('AdapterFetchResult');
      expect(content).toContain('options: { name: string } & OpenapiAdapterOptions');
    });
  });

  describe('starter specs', () => {
    it.each([
      ['generic', 'libs/x/src/x.spec.ts', "from './x'"],
      ['plugin', 'libs/x/src/x.plugin.spec.ts', "from './x.plugin'"],
      ['adapter', 'libs/x/src/x.adapter.spec.ts', "from './x.adapter'"],
      ['tool-register', 'libs/x/src/x.tools.spec.ts', "from './x.tools'"],
    ] as const)('gives a %s library a spec, so `nx test` finds tests', async (libType, specPath, importLine) => {
      await libGenerator(tree, { name: 'x', libType, skipFormat: true });

      expect(tree.read(specPath, 'utf-8')).toContain(importLine);
    });
  });

  describe('test target', () => {
    it('runs the jest config with frontmcp test, so it needs no @nx/jest in the workspace', async () => {
      await libGenerator(tree, { name: 'my-lib', skipFormat: true });

      expect(readJson(tree, 'libs/my-lib/project.json').targets.test).toEqual({
        executor: '@frontmcp/nx:test',
        cache: true,
        options: {},
      });
      expect(tree.exists('libs/my-lib/jest.config.cjs')).toBe(true);
    });
  });

  describe('typescript configuration', () => {
    it('type-checks with its own target instead of the inferred tsc --build one (TS5069)', async () => {
      await libGenerator(tree, { name: 'my-lib', skipFormat: true });

      expect(readJson(tree, 'libs/my-lib/tsconfig.json').nx).toEqual({ addTypecheckTarget: false });
      expect(readJson(tree, 'libs/my-lib/project.json').targets.typecheck).toMatchObject({
        executor: 'nx:run-commands',
        options: {
          commands: ['tsc --noEmit -p tsconfig.lib.json', 'tsc --noEmit -p tsconfig.spec.json'],
          cwd: '{projectRoot}',
        },
      });
    });

    it('sets the module settings once, in tsconfig.json, for sources and specs alike', async () => {
      await libGenerator(tree, { name: 'my-lib', skipFormat: true });

      expect(readJson(tree, 'libs/my-lib/tsconfig.json').compilerOptions).toMatchObject({
        module: 'commonjs',
        moduleResolution: 'node10',
        composite: false,
        declarationMap: false,
        emitDeclarationOnly: false,
      });
      const spec = readJson(tree, 'libs/my-lib/tsconfig.spec.json').compilerOptions;
      expect(spec.module).toBeUndefined();
      expect(spec.moduleResolution).toBeUndefined();
    });

    it('resolves with bundler on TypeScript 6', async () => {
      tree.write('package.json', JSON.stringify({ devDependencies: { typescript: '~6.0.3' } }));
      await libGenerator(tree, { name: 'my-lib', skipFormat: true });

      expect(readJson(tree, 'libs/my-lib/tsconfig.json').compilerOptions.moduleResolution).toBe('bundler');
    });
  });

  describe('adapter library', () => {
    it('should generate an adapter library', async () => {
      await libGenerator(tree, { name: 'openapi', libType: 'adapter', skipFormat: true });

      expect(tree.exists('libs/openapi/src/openapi.adapter.ts')).toBe(true);

      const content = tree.read('libs/openapi/src/openapi.adapter.ts', 'utf-8');
      expect(content).toContain('@Adapter(');
      expect(content).toContain('extends DynamicAdapter');
    });
  });

  describe('tool-register library', () => {
    it('should generate a tool register library', async () => {
      await libGenerator(tree, { name: 'data-tools', libType: 'tool-register', skipFormat: true });

      expect(tree.exists('libs/data-tools/src/data-tools.tools.ts')).toBe(true);

      const content = tree.read('libs/data-tools/src/data-tools.tools.ts', 'utf-8');
      expect(content).toContain('@Tool(');
      expect(content).toContain('DataToolsTools');
    });
  });

  describe('custom import path', () => {
    it('should use custom importPath when provided', async () => {
      await libGenerator(tree, { name: 'my-lib', importPath: '@my-org/shared-lib', skipFormat: true });

      const tsconfig = readJson(tree, 'tsconfig.base.json');
      expect(tsconfig.compilerOptions.paths['@my-org/shared-lib']).toEqual([
        './libs/my-lib/src/index.ts',
      ]);
    });
  });

  describe('custom directory', () => {
    it('should use custom directory', async () => {
      await libGenerator(tree, { name: 'my-lib', directory: 'packages/my-lib' });

      expect(tree.exists('packages/my-lib/src/index.ts')).toBe(true);
    });
  });

  describe('publishable library', () => {
    it('should add publishable tag', async () => {
      await libGenerator(tree, { name: 'shared', publishable: true, skipFormat: true });

      const projectJson = readJson(tree, 'libs/shared/project.json');
      expect(projectJson.tags).toContain('scope:publishable');
    });
  });

  describe('custom tags', () => {
    it('should parse custom tags', async () => {
      await libGenerator(tree, { name: 'shared', tags: 'type:util, scope:core', skipFormat: true });

      const projectJson = readJson(tree, 'libs/shared/project.json');
      expect(projectJson.tags).toContain('type:util');
      expect(projectJson.tags).toContain('scope:core');
    });
  });

  describe('without tsconfig.base.json', () => {
    it('should not fail when tsconfig.base.json does not exist', async () => {
      tree.delete('tsconfig.base.json');

      await libGenerator(tree, { name: 'my-lib', skipFormat: true });

      expect(tree.exists('libs/my-lib/src/index.ts')).toBe(true);
      expect(tree.exists('tsconfig.base.json')).toBe(false);
    });
  });

  it('should export default', async () => {
    const mod = await import('./lib');
    expect(mod.default).toBe(libGenerator);
  });
});
