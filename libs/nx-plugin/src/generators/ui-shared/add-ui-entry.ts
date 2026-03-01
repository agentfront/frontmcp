import { type Tree, updateJson } from '@nx/devkit';

export interface AddUiEntryOptions {
  /** The UI package root, e.g. 'ui/components' */
  packageRoot: string;
  /** The entry name, e.g. 'LoginForm' or 'admin-dashboard' */
  entryName: string;
  /** The npm scope name, e.g. '@frontmcp/ui-components' */
  importPath: string;
}

/**
 * Adds an entry point to an existing UI package:
 * 1. Updates project.json `additionalEntryPoints` in both build-cjs and build-esm
 * 2. Updates tsconfig.base.json path aliases (wildcard already covers it, but explicit is fine)
 * 3. Adds re-export to the barrel index.ts
 */
export function addUiEntry(tree: Tree, options: AddUiEntryOptions): void {
  const { packageRoot, entryName, importPath } = options;
  const entryPath = `${packageRoot}/src/${entryName}/index.ts`;

  // 1. Update project.json — add to additionalEntryPoints in build-cjs and build-esm
  const projectJsonPath = `${packageRoot}/project.json`;
  if (tree.exists(projectJsonPath)) {
    updateJson(tree, projectJsonPath, (json) => {
      for (const target of ['build-cjs', 'build-esm']) {
        const opts = json.targets?.[target]?.options;
        if (opts) {
          opts.additionalEntryPoints = opts.additionalEntryPoints ?? [];
          if (!opts.additionalEntryPoints.includes(entryPath)) {
            opts.additionalEntryPoints.push(entryPath);
          }
        }
      }
      return json;
    });
  }

  // 2. Update tsconfig.base.json — add explicit path alias
  //    The wildcard alias already covers resolution, but adding an explicit
  //    entry improves IDE completion and Nx dep graph accuracy.
  if (tree.exists('tsconfig.base.json')) {
    updateJson(tree, 'tsconfig.base.json', (json) => {
      const paths = json.compilerOptions?.paths ?? {};
      const aliasKey = `${importPath}/${entryName}`;
      if (!paths[aliasKey]) {
        paths[aliasKey] = [`${packageRoot}/src/${entryName}/index.ts`];
      }
      json.compilerOptions = json.compilerOptions ?? {};
      json.compilerOptions.paths = paths;
      return json;
    });
  }

  // 3. Add re-export to barrel index.ts
  const barrelPath = `${packageRoot}/src/index.ts`;
  if (tree.exists(barrelPath)) {
    const existing = tree.read(barrelPath, 'utf-8') ?? '';
    const exportLine = `export * from './${entryName}';\n`;
    const duplicatePattern = new RegExp(`^export \\* from '\\./${entryName}';?$`, 'm');
    if (!duplicatePattern.test(existing)) {
      const normalized = existing.endsWith('\n') || existing === '' ? existing : existing + '\n';
      tree.write(barrelPath, normalized + exportLine);
    }
  }
}
