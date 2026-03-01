import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, readJson } from '@nx/devkit';
import { uiPageGenerator } from './ui-page';

describe('ui-page generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();

    // Create minimal ui/pages package structure
    tree.write('ui/pages/src/index.ts', '');
    tree.write(
      'ui/pages/project.json',
      JSON.stringify({
        name: 'ui-pages',
        targets: {
          'build-cjs': { options: { additionalEntryPoints: [] } },
          'build-esm': { options: { additionalEntryPoints: [] } },
        },
      }),
    );
    tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: {} } }));
  });

  it('should generate page files', async () => {
    await uiPageGenerator(tree, { name: 'AdminDashboard', skipFormat: true });

    expect(tree.exists('ui/pages/src/AdminDashboard/index.ts')).toBe(true);
    expect(tree.exists('ui/pages/src/AdminDashboard/AdminDashboard.tsx')).toBe(true);
    expect(tree.exists('ui/pages/src/AdminDashboard/AdminDashboard.spec.tsx')).toBe(true);
  });

  it('should use correct class name in page', async () => {
    await uiPageGenerator(tree, { name: 'AdminDashboard', skipFormat: true });

    const content = tree.read('ui/pages/src/AdminDashboard/AdminDashboard.tsx', 'utf-8');
    expect(content).toContain('export function AdminDashboard');
    expect(content).toContain('AdminDashboardProps');
  });

  it('should add entry to project.json additionalEntryPoints', async () => {
    await uiPageGenerator(tree, { name: 'AdminDashboard', skipFormat: true });

    const project = readJson(tree, 'ui/pages/project.json');
    expect(project.targets['build-cjs'].options.additionalEntryPoints).toContain(
      'ui/pages/src/AdminDashboard/index.ts',
    );
    expect(project.targets['build-esm'].options.additionalEntryPoints).toContain(
      'ui/pages/src/AdminDashboard/index.ts',
    );
  });

  it('should add path alias to tsconfig.base.json', async () => {
    await uiPageGenerator(tree, { name: 'AdminDashboard', skipFormat: true });

    const tsconfig = readJson(tree, 'tsconfig.base.json');
    expect(tsconfig.compilerOptions.paths['@frontmcp/ui-pages/AdminDashboard']).toEqual([
      'ui/pages/src/AdminDashboard/index.ts',
    ]);
  });

  it('should add re-export to barrel index.ts', async () => {
    await uiPageGenerator(tree, { name: 'AdminDashboard', skipFormat: true });

    const barrel = tree.read('ui/pages/src/index.ts', 'utf-8');
    expect(barrel).toContain("from './AdminDashboard'");
  });

  it('should generate correct page file content', async () => {
    await uiPageGenerator(tree, { name: 'AdminDashboard', skipFormat: true });

    const content = tree.read('ui/pages/src/AdminDashboard/AdminDashboard.tsx', 'utf-8');
    if (!content) throw new Error('Expected AdminDashboard.tsx to exist');
    expect(content).not.toContain("import React from 'react'");
    expect(content).toContain("import { Box, Typography } from '@mui/material'");
    expect(content).toContain('export interface AdminDashboardProps');
    expect(content).toContain('export function AdminDashboard(');
    expect(content).toContain("title = 'AdminDashboard'");
  });

  it('should generate index barrel with correct exports', async () => {
    await uiPageGenerator(tree, { name: 'AdminDashboard', skipFormat: true });

    const index = tree.read('ui/pages/src/AdminDashboard/index.ts', 'utf-8');
    if (!index) throw new Error('Expected AdminDashboard/index.ts to exist');
    expect(index).toContain("export { AdminDashboard } from './AdminDashboard'");
    expect(index).toContain("export { AdminDashboard as default } from './AdminDashboard'");
    expect(index).toContain("export type { AdminDashboardProps } from './AdminDashboard'");
  });

  it('should not duplicate entries when generated twice', async () => {
    await uiPageGenerator(tree, { name: 'AdminDashboard', skipFormat: true });
    await uiPageGenerator(tree, { name: 'AdminDashboard', skipFormat: true });

    const project = readJson(tree, 'ui/pages/project.json');
    const cjs = project.targets['build-cjs'].options.additionalEntryPoints;
    expect(cjs.filter((e: string) => e.includes('AdminDashboard'))).toHaveLength(1);

    const barrel = tree.read('ui/pages/src/index.ts', 'utf-8');
    if (!barrel) throw new Error('Expected barrel index.ts to exist');
    const matches = barrel.match(/export \* from '\.\/AdminDashboard'/g);
    expect(matches).toHaveLength(1);
  });

  it('should not crash when project.json is missing', async () => {
    tree.delete('ui/pages/project.json');

    await expect(uiPageGenerator(tree, { name: 'AdminDashboard', skipFormat: true })).resolves.toBeUndefined();

    expect(tree.exists('ui/pages/src/AdminDashboard/AdminDashboard.tsx')).toBe(true);
  });

  it('should not crash when tsconfig.base.json is missing', async () => {
    tree.delete('tsconfig.base.json');

    await expect(uiPageGenerator(tree, { name: 'AdminDashboard', skipFormat: true })).resolves.toBeUndefined();

    expect(tree.exists('ui/pages/src/AdminDashboard/AdminDashboard.tsx')).toBe(true);
  });
});
