import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, readJson } from '@nx/devkit';
import { uiShellGenerator } from './ui-shell';

describe('ui-shell generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();

    // Create minimal ui/shells package structure
    tree.write('ui/shells/src/index.ts', '');
    tree.write(
      'ui/shells/project.json',
      JSON.stringify({
        name: 'ui-shells',
        targets: {
          'build-cjs': { options: { additionalEntryPoints: [] } },
          'build-esm': { options: { additionalEntryPoints: [] } },
        },
      }),
    );
    tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: {} } }));
  });

  it('should generate shell files in kebab-case', async () => {
    await uiShellGenerator(tree, { name: 'admin-dashboard', skipFormat: true });

    expect(tree.exists('ui/shells/src/admin-dashboard/index.ts')).toBe(true);
    expect(tree.exists('ui/shells/src/admin-dashboard/admin-dashboard.shell.ts')).toBe(true);
    expect(tree.exists('ui/shells/src/admin-dashboard/admin-dashboard.shell.spec.ts')).toBe(true);
  });

  it('should use correct class name in shell', async () => {
    await uiShellGenerator(tree, { name: 'admin-dashboard', skipFormat: true });

    const content = tree.read('ui/shells/src/admin-dashboard/admin-dashboard.shell.ts', 'utf-8');
    expect(content).toContain('buildAdminDashboardShell');
    expect(content).toContain('AdminDashboardShellOptions');
  });

  it('should add entry to project.json additionalEntryPoints', async () => {
    await uiShellGenerator(tree, { name: 'admin-dashboard', skipFormat: true });

    const project = readJson(tree, 'ui/shells/project.json');
    expect(project.targets['build-cjs'].options.additionalEntryPoints).toContain(
      'ui/shells/src/admin-dashboard/index.ts',
    );
  });

  it('should add path alias to tsconfig.base.json', async () => {
    await uiShellGenerator(tree, { name: 'admin-dashboard', skipFormat: true });

    const tsconfig = readJson(tree, 'tsconfig.base.json');
    expect(tsconfig.compilerOptions.paths['@frontmcp/ui-shells/admin-dashboard']).toEqual([
      'ui/shells/src/admin-dashboard/index.ts',
    ]);
  });

  it('should add re-export to barrel index.ts', async () => {
    await uiShellGenerator(tree, { name: 'admin-dashboard', skipFormat: true });

    const barrel = tree.read('ui/shells/src/index.ts', 'utf-8');
    expect(barrel).toContain("from './admin-dashboard'");
  });

  it('should handle PascalCase input by converting to kebab-case', async () => {
    await uiShellGenerator(tree, { name: 'MyDashboard', skipFormat: true });

    expect(tree.exists('ui/shells/src/my-dashboard/my-dashboard.shell.ts')).toBe(true);
  });

  it('should generate correct shell file content', async () => {
    await uiShellGenerator(tree, { name: 'admin-dashboard', skipFormat: true });

    const content = tree.read('ui/shells/src/admin-dashboard/admin-dashboard.shell.ts', 'utf-8')!;
    expect(content).toContain("import { buildShell } from '@frontmcp/uipack'");
    expect(content).toContain('export interface AdminDashboardShellOptions');
    expect(content).toContain('export function buildAdminDashboardShell(options: AdminDashboardShellOptions)');
    expect(content).toContain('return buildShell(content');
  });

  it('should generate index barrel with correct exports', async () => {
    await uiShellGenerator(tree, { name: 'admin-dashboard', skipFormat: true });

    const index = tree.read('ui/shells/src/admin-dashboard/index.ts', 'utf-8')!;
    expect(index).toContain("export { buildAdminDashboardShell } from './admin-dashboard.shell'");
    expect(index).toContain("export type { AdminDashboardShellOptions } from './admin-dashboard.shell'");
  });

  it('should not duplicate entries when generated twice', async () => {
    await uiShellGenerator(tree, { name: 'admin-dashboard', skipFormat: true });
    await uiShellGenerator(tree, { name: 'admin-dashboard', skipFormat: true });

    const project = readJson(tree, 'ui/shells/project.json');
    const cjs = project.targets['build-cjs'].options.additionalEntryPoints;
    expect(cjs.filter((e: string) => e.includes('admin-dashboard'))).toHaveLength(1);

    const barrel = tree.read('ui/shells/src/index.ts', 'utf-8')!;
    const matches = barrel.match(/export \* from '\.\/admin-dashboard'/g);
    expect(matches).toHaveLength(1);
  });

  it('should not crash when project.json is missing', async () => {
    tree.delete('ui/shells/project.json');

    await expect(uiShellGenerator(tree, { name: 'admin-dashboard', skipFormat: true })).resolves.not.toThrow();

    expect(tree.exists('ui/shells/src/admin-dashboard/admin-dashboard.shell.ts')).toBe(true);
  });

  it('should not crash when tsconfig.base.json is missing', async () => {
    tree.delete('tsconfig.base.json');

    await expect(uiShellGenerator(tree, { name: 'admin-dashboard', skipFormat: true })).resolves.not.toThrow();

    expect(tree.exists('ui/shells/src/admin-dashboard/admin-dashboard.shell.ts')).toBe(true);
  });
});
