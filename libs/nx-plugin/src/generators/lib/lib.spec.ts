import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, readJson } from '@nx/devkit';
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
      expect(tsconfig.compilerOptions.paths['@frontmcp/my-lib']).toEqual([
        'libs/my-lib/src/index.ts',
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
        'libs/my-lib/src/index.ts',
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
});
