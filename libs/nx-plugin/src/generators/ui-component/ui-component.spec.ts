import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, readJson } from '@nx/devkit';
import { uiComponentGenerator } from './ui-component';

describe('ui-component generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();

    // Create minimal ui/components package structure
    tree.write('ui/components/src/index.ts', '');
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
    tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: {} } }));
  });

  it('should generate component files', async () => {
    await uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true });

    expect(tree.exists('ui/components/src/LoginForm/index.ts')).toBe(true);
    expect(tree.exists('ui/components/src/LoginForm/LoginForm.tsx')).toBe(true);
    expect(tree.exists('ui/components/src/LoginForm/LoginForm.spec.tsx')).toBe(true);
  });

  it('should use correct class name in component', async () => {
    await uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true });

    const content = tree.read('ui/components/src/LoginForm/LoginForm.tsx', 'utf-8');
    expect(content).toContain('export function LoginForm');
    expect(content).toContain('LoginFormProps');
  });

  it('should add entry to project.json additionalEntryPoints', async () => {
    await uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true });

    const project = readJson(tree, 'ui/components/project.json');
    expect(project.targets['build-cjs'].options.additionalEntryPoints).toContain(
      'ui/components/src/LoginForm/index.ts',
    );
    expect(project.targets['build-esm'].options.additionalEntryPoints).toContain(
      'ui/components/src/LoginForm/index.ts',
    );
  });

  it('should add path alias to tsconfig.base.json', async () => {
    await uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true });

    const tsconfig = readJson(tree, 'tsconfig.base.json');
    expect(tsconfig.compilerOptions.paths['@frontmcp/ui-components/LoginForm']).toEqual([
      'ui/components/src/LoginForm/index.ts',
    ]);
  });

  it('should add re-export to barrel index.ts', async () => {
    await uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true });

    const barrel = tree.read('ui/components/src/index.ts', 'utf-8');
    expect(barrel).toContain("from './LoginForm'");
  });

  it('should handle kebab-case names', async () => {
    await uiComponentGenerator(tree, { name: 'my-widget', skipFormat: true });

    expect(tree.exists('ui/components/src/MyWidget/MyWidget.tsx')).toBe(true);
  });

  it('should generate correct component file content', async () => {
    await uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true });

    const content = tree.read('ui/components/src/LoginForm/LoginForm.tsx', 'utf-8');
    if (!content) throw new Error('Expected LoginForm.tsx to exist');
    expect(content).toContain("import React from 'react'");
    expect(content).toContain("import { Box, Typography } from '@mui/material'");
    expect(content).toContain('export interface LoginFormProps');
    expect(content).toContain('export function LoginForm(props: LoginFormProps)');
  });

  it('should generate index barrel with correct exports', async () => {
    await uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true });

    const index = tree.read('ui/components/src/LoginForm/index.ts', 'utf-8');
    if (!index) throw new Error('Expected LoginForm/index.ts to exist');
    expect(index).toContain("export { LoginForm } from './LoginForm'");
    expect(index).toContain("export { LoginForm as default } from './LoginForm'");
    expect(index).toContain("export type { LoginFormProps } from './LoginForm'");
  });

  it('should not duplicate entries when generated twice', async () => {
    await uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true });
    await uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true });

    const project = readJson(tree, 'ui/components/project.json');
    const cjs = project.targets['build-cjs'].options.additionalEntryPoints;
    expect(cjs.filter((e: string) => e.includes('LoginForm'))).toHaveLength(1);

    const barrel = tree.read('ui/components/src/index.ts', 'utf-8');
    if (!barrel) throw new Error('Expected barrel index.ts to exist');
    const matches = barrel.match(/export \* from '\.\/LoginForm'/g);
    expect(matches).toHaveLength(1);
  });

  it('should not crash when project.json is missing', async () => {
    tree.delete('ui/components/project.json');

    await expect(uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true })).resolves.toBeUndefined();

    expect(tree.exists('ui/components/src/LoginForm/LoginForm.tsx')).toBe(true);
  });

  it('should not crash when tsconfig.base.json is missing', async () => {
    tree.delete('tsconfig.base.json');

    await expect(uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true })).resolves.toBeUndefined();

    expect(tree.exists('ui/components/src/LoginForm/LoginForm.tsx')).toBe(true);
  });
});
