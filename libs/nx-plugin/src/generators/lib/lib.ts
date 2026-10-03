import { join } from 'path';

import { formatFiles, generateFiles, readJson, writeJson, type GeneratorCallback, type Tree } from '@nx/devkit';

import { addTsPathAlias } from '../../utils/project-paths.js';
import { getFrontmcpVersion } from '../../utils/versions.js';
import { normalizeOptions, type NormalizedLibOptions } from './lib/index.js';
import type { LibGeneratorSchema } from './schema.js';

/**
 * Plugin and adapter libraries start from the class the `plugin` / `adapter` generators write,
 * so there is one template per class instead of two that drift apart.
 */
const CLASS_GENERATOR: Partial<Record<NormalizedLibOptions['libType'], string>> = {
  plugin: 'plugin',
  adapter: 'adapter',
};

interface WorkspacePackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * A publishable library is published from its own folder after its `build` target compiles
 * `tsconfig.lib.json` into `dist/`, so the manifest points there and lists what the emitted JavaScript
 * requires: tslib (the base config sets `importHelpers`) and, for the FrontMCP library types, the SDK.
 * Both use the workspace's range when it declares one.
 */
function writePublishablePackageJson(tree: Tree, options: NormalizedLibOptions): void {
  const workspace = tree.exists('package.json') ? readJson<WorkspacePackageJson>(tree, 'package.json') : {};
  const workspaceRange = (name: string): string | undefined =>
    workspace.dependencies?.[name] ?? workspace.devDependencies?.[name];

  writeJson(tree, `${options.projectRoot}/package.json`, {
    name: options.importPath,
    version: '0.0.1',
    type: 'commonjs',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    files: ['dist'],
    dependencies: {
      ...(options.libType !== 'generic' && {
        '@frontmcp/sdk': workspaceRange('@frontmcp/sdk') ?? `~${getFrontmcpVersion()}`,
      }),
      tslib: workspaceRange('tslib') ?? '^2.3.0',
    },
  });
}

export async function libGenerator(tree: Tree, schema: LibGeneratorSchema): Promise<GeneratorCallback | void> {
  return libGeneratorInternal(tree, schema);
}

async function libGeneratorInternal(tree: Tree, schema: LibGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizeOptions(tree, schema);
  const substitutions = { ...options, tmpl: '' };

  // Generate project config files (project.json, tsconfig, jest)
  generateFiles(tree, join(__dirname, 'lib-project-files'), options.projectRoot, substitutions);

  // Generate type-specific source files (barrel and starter spec)
  generateFiles(tree, join(__dirname, 'files', options.libType), options.projectRoot, substitutions);

  const classGenerator = CLASS_GENERATOR[options.libType];
  if (classGenerator) {
    const srcDir = join(options.projectRoot, 'src');
    generateFiles(tree, join(__dirname, '..', classGenerator, 'files'), srcDir, substitutions);
    // The plugin generator's opt-in context extension is not part of a new library.
    const contextExtension = join(srcDir, `${options.fileName}.context-extension.ts`);
    if (tree.exists(contextExtension)) tree.delete(contextExtension);
  }

  if (options.publishable) {
    writePublishablePackageJson(tree, options);
  }

  addTsPathAlias(tree, options.importPath, `${options.projectRoot}/src/index.ts`);

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default libGenerator;
