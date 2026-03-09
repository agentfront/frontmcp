import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, readJson } from '@nx/devkit';
import { addUiEntry, type AddUiEntryOptions } from './add-ui-entry';

describe('addUiEntry', () => {
  let tree: Tree;

  const defaultOptions: AddUiEntryOptions = {
    packageRoot: 'ui/components',
    entryName: 'LoginForm',
    importPath: '@frontmcp/ui-components',
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  describe('project.json', () => {
    it('should update additionalEntryPoints in both build-cjs and build-esm targets', () => {
      tree.write(
        'ui/components/project.json',
        JSON.stringify({
          name: 'ui-components',
          targets: {
            'build-cjs': { options: { additionalEntryPoints: [] } },
            'build-esm': { options: { additionalEntryPoints: [] } },
          },
        }),
      );

      addUiEntry(tree, defaultOptions);

      const project = readJson(tree, 'ui/components/project.json');
      expect(project.targets['build-cjs'].options.additionalEntryPoints).toContain(
        'ui/components/src/LoginForm/index.ts',
      );
      expect(project.targets['build-esm'].options.additionalEntryPoints).toContain(
        'ui/components/src/LoginForm/index.ts',
      );
    });

    it('should create additionalEntryPoints array when it does not exist yet', () => {
      tree.write(
        'ui/components/project.json',
        JSON.stringify({
          name: 'ui-components',
          targets: {
            'build-cjs': { options: {} },
            'build-esm': { options: {} },
          },
        }),
      );

      addUiEntry(tree, defaultOptions);

      const project = readJson(tree, 'ui/components/project.json');
      expect(project.targets['build-cjs'].options.additionalEntryPoints).toEqual([
        'ui/components/src/LoginForm/index.ts',
      ]);
      expect(project.targets['build-esm'].options.additionalEntryPoints).toEqual([
        'ui/components/src/LoginForm/index.ts',
      ]);
    });

    it('should skip gracefully when project.json does not exist', () => {
      expect(() => addUiEntry(tree, defaultOptions)).not.toThrow();
    });

    it('should skip gracefully when targets or options are missing', () => {
      tree.write('ui/components/project.json', JSON.stringify({ name: 'ui-components', targets: {} }));

      expect(() => addUiEntry(tree, defaultOptions)).not.toThrow();

      const project = readJson(tree, 'ui/components/project.json');
      expect(project.targets).toEqual({});
    });
  });

  describe('tsconfig.base.json', () => {
    it('should add path alias @scope/pkg/Entry → root/src/Entry/index.ts', () => {
      tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: {} } }));

      addUiEntry(tree, defaultOptions);

      const tsconfig = readJson(tree, 'tsconfig.base.json');
      expect(tsconfig.compilerOptions.paths['@frontmcp/ui-components/LoginForm']).toEqual([
        'ui/components/src/LoginForm/index.ts',
      ]);
    });

    it('should create compilerOptions.paths when missing', () => {
      tree.write('tsconfig.base.json', JSON.stringify({}));

      addUiEntry(tree, defaultOptions);

      const tsconfig = readJson(tree, 'tsconfig.base.json');
      expect(tsconfig.compilerOptions.paths['@frontmcp/ui-components/LoginForm']).toEqual([
        'ui/components/src/LoginForm/index.ts',
      ]);
    });

    it('should skip gracefully when tsconfig.base.json does not exist', () => {
      expect(() => addUiEntry(tree, defaultOptions)).not.toThrow();
    });
  });

  describe('barrel index.ts', () => {
    it('should append export * from ./Entry to barrel', () => {
      tree.write('ui/components/src/index.ts', '');

      addUiEntry(tree, defaultOptions);

      const barrel = tree.read('ui/components/src/index.ts', 'utf-8');
      expect(barrel).toContain("export * from './LoginForm';");
    });

    it('should skip gracefully when barrel does not exist', () => {
      expect(() => addUiEntry(tree, defaultOptions)).not.toThrow();
    });
  });

  describe('deduplication', () => {
    it('should not add duplicate additionalEntryPoints', () => {
      tree.write(
        'ui/components/project.json',
        JSON.stringify({
          name: 'ui-components',
          targets: {
            'build-cjs': { options: { additionalEntryPoints: [] } },
            'build-esm': { options: { additionalEntryPoints: [] } },
          },
        }),
      );

      addUiEntry(tree, defaultOptions);
      addUiEntry(tree, defaultOptions);

      const project = readJson(tree, 'ui/components/project.json');
      const cjsEntries = project.targets['build-cjs'].options.additionalEntryPoints;
      const esmEntries = project.targets['build-esm'].options.additionalEntryPoints;
      expect(cjsEntries.filter((e: string) => e.includes('LoginForm'))).toHaveLength(1);
      expect(esmEntries.filter((e: string) => e.includes('LoginForm'))).toHaveLength(1);
    });

    it('should not add duplicate path alias', () => {
      tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: {} } }));

      addUiEntry(tree, defaultOptions);
      addUiEntry(tree, defaultOptions);

      const tsconfig = readJson(tree, 'tsconfig.base.json');
      expect(tsconfig.compilerOptions.paths['@frontmcp/ui-components/LoginForm']).toEqual([
        'ui/components/src/LoginForm/index.ts',
      ]);
    });

    it('should not add duplicate barrel export', () => {
      tree.write('ui/components/src/index.ts', '');

      addUiEntry(tree, defaultOptions);
      addUiEntry(tree, defaultOptions);

      const barrel = tree.read('ui/components/src/index.ts', 'utf-8');
      if (!barrel) throw new Error('Expected barrel index.ts to exist');
      const matches = barrel.match(/export \* from '\.\/LoginForm'/g);
      expect(matches).toHaveLength(1);
    });
  });
});
