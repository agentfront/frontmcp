import { offsetFromRoot, readJson, runTasksInSerial, writeJson, type GeneratorCallback, type Tree } from '@nx/devkit';

import { addFrontmcpDependencies } from '../../utils/add-dependencies.js';
import { getModuleResolution } from '../../utils/project-paths.js';
import { getFrontmcpVersion, getUiBuildDevDependencies } from '../../utils/versions.js';

export interface EnsureUiPackageOptions {
  /** e.g. 'ui/components' */
  packageRoot: string;
  /** Nx project name for a package that does not exist yet, e.g. 'ui-components' */
  projectName: string;
  /** 'react' packages render components and are tested in jsdom; 'shell' packages only build HTML strings. */
  kind: 'react' | 'shell';
}

const REACT_DEPENDENCIES: Record<string, string> = {
  react: '^19.0.0',
  'react-dom': '^19.0.0',
  '@mui/material': '^7.0.0',
  '@emotion/react': '^11.14.0',
  '@emotion/styled': '^11.14.0',
};

const REACT_DEV_DEPENDENCIES: Record<string, string> = {
  '@types/react': '^19.0.0',
  '@types/react-dom': '^19.0.0',
  '@testing-library/dom': '^10.4.0',
  '@testing-library/react': '^16.0.0',
  'jest-environment-jsdom': '^30.0.2',
};

function buildTargets(packageRoot: string): Record<string, unknown> {
  const common = {
    main: `${packageRoot}/src/index.ts`,
    tsConfig: `${packageRoot}/tsconfig.json`,
    bundle: true,
    thirdParty: false,
    platform: 'node',
    additionalEntryPoints: [] as string[],
  };
  return {
    'build-cjs': {
      executor: '@nx/esbuild:esbuild',
      outputs: ['{options.outputPath}'],
      options: { ...common, outputPath: `dist/${packageRoot}`, format: ['cjs'], declaration: true },
    },
    'build-esm': {
      executor: '@nx/esbuild:esbuild',
      dependsOn: ['build-cjs'],
      outputs: ['{options.outputPath}'],
      options: {
        ...common,
        outputPath: `dist/${packageRoot}/esm`,
        format: ['esm'],
        declaration: false,
        esbuildOptions: { outExtension: { '.js': '.mjs' } },
      },
    },
    build: {
      executor: 'nx:noop',
      dependsOn: ['build-cjs', 'build-esm'],
    },
  };
}

/**
 * The UI generators emit `.tsx` files that import React and MUI (or the uipack
 * shell builder), and a spec that renders them. Nothing else installs those, so
 * the generators add them — and create the package folder when the workspace
 * does not have one yet, instead of writing files into a folder that no Nx
 * project owns.
 */
export function ensureUiPackage(tree: Tree, options: EnsureUiPackageOptions): GeneratorCallback {
  const { packageRoot, projectName, kind } = options;

  if (!tree.exists(`${packageRoot}/project.json`)) {
    const offset = offsetFromRoot(packageRoot);
    // `customConditions` (Nx solution workspaces set it) is only valid with a modern `moduleResolution`
    // (TS5098), so a package that inherits it must inherit the base's `module`/`moduleResolution` too.
    const inheritsModernResolution = Boolean(
      tree.exists('tsconfig.base.json') &&
        readJson<{ compilerOptions?: { customConditions?: unknown } }>(tree, 'tsconfig.base.json').compilerOptions
          ?.customConditions,
    );
    writeJson(tree, `${packageRoot}/project.json`, {
      name: projectName,
      $schema: `${offset}node_modules/nx/schemas/project-schema.json`,
      sourceRoot: `${packageRoot}/src`,
      projectType: 'library',
      tags: [],
      targets: buildTargets(packageRoot),
    });
    writeJson(tree, `${packageRoot}/tsconfig.json`, {
      extends: `${offset}tsconfig.base.json`,
      compilerOptions: {
        ...(!inheritsModernResolution && { module: 'commonjs', moduleResolution: getModuleResolution(tree) }),
        ...(kind === 'react' && { jsx: 'react-jsx' }),
        esModuleInterop: true,
        strict: true,
      },
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    });
    tree.write(
      `${packageRoot}/jest.config.cjs`,
      `module.exports = {
  displayName: '${projectName}',
  testEnvironment: '${kind === 'react' ? 'jsdom' : 'node'}',
  transform: {
    '^.+\\\\.[tj]sx?$': ['@swc/jest', {
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', tsx: true },
        transform: { react: { runtime: 'automatic' } },
      },
      swcrc: false,
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
};
`,
    );
    if (!tree.exists(`${packageRoot}/src/index.ts`)) {
      tree.write(`${packageRoot}/src/index.ts`, '');
    }
  }

  const range = `~${getFrontmcpVersion()}`;
  const { esbuild, ...buildDevDependencies } = getUiBuildDevDependencies();
  const installUiDependencies =
    kind === 'react'
      ? addFrontmcpDependencies(
          tree,
          REACT_DEPENDENCIES,
          { ...REACT_DEV_DEPENDENCIES, ...buildDevDependencies },
          { keepExistingVersions: true },
        )
      : addFrontmcpDependencies(tree, { '@frontmcp/uipack': range }, buildDevDependencies, {
          keepExistingVersions: true,
        });
  // An existing esbuild range is raised rather than kept when it is older than ours: the `^0.25.0` earlier
  // versions of these generators wrote is below the `>=0.27` peer range of @frontmcp/uipack (npm ERESOLVE).
  // A range at or above ours stays, in whichever section it is in.
  const installEsbuild = addFrontmcpDependencies(tree, {}, { esbuild }, { keepExistingVersions: false });
  return runTasksInSerial(installUiDependencies, installEsbuild);
}
