import * as path from 'path';

interface JestPreset {
  transform: Record<string, unknown>;
  moduleFileExtensions: string[];
  transformIgnorePatterns: string[];
  testMatch: string[];
  testPathIgnorePatterns: string[];
  testTimeout?: number;
  setupFilesAfterEnv?: string[];
}

interface ProjectConfig {
  transform: [pattern: string, transformerPath: string, options: unknown][];
  transformIgnorePatterns: string[];
}

const packageRoot = path.resolve(__dirname, '../..');
const unitPreset = require('../../jest-preset-unit.js') as JestPreset;
const e2ePreset = require('../../jest-preset.js') as JestPreset;
const { globsToMatcher } = require('jest-util') as { globsToMatcher(globs: string[]): (filePath: string) => boolean };
const { readConfig } = require('jest-config') as {
  readConfig(
    argv: object,
    config: object,
    skipArgvConfigOption: boolean,
    configDir: string,
  ): Promise<{ projectConfig: ProjectConfig }>;
};

async function resolveConfig(config: object): Promise<ProjectConfig> {
  const { projectConfig } = await readConfig({}, { rootDir: packageRoot, ...config }, false, packageRoot);
  return projectConfig;
}

function transformerFor(config: ProjectConfig, filePath: string): string | undefined {
  return config.transform.find(([pattern]) => new RegExp(pattern).test(filePath))?.[1];
}

const isIgnored = (patterns: string[], filePath: string) =>
  patterns.some((pattern) => new RegExp(pattern).test(filePath));

describe('@frontmcp/testing/jest-preset-unit', () => {
  it('is what `preset: "@frontmcp/testing/jest-preset-unit"` and the package export load', async () => {
    const config = await resolveConfig({ preset: '@frontmcp/testing/jest-preset-unit' });

    expect(require('@frontmcp/testing/jest-preset-unit')).toBe(unitPreset);
    expect(config.transformIgnorePatterns).toEqual(unitPreset.transformIgnorePatterns);
  });

  it('shares the transform of @frontmcp/testing/jest-preset', () => {
    expect(unitPreset.transform).toBe(e2ePreset.transform);
    expect(unitPreset.transformIgnorePatterns).toBe(e2ePreset.transformIgnorePatterns);
    expect(unitPreset.moduleFileExtensions).toBe(e2ePreset.moduleFileExtensions);
  });

  it.each([
    '/proj/node_modules/jose/dist/webapi/index.js',
    '/proj/node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/index.js',
    '/proj/node_modules/@noble/hashes/sha2.js',
    '/proj/node_modules/.pnpm/@noble+ciphers@2.1.1/node_modules/@noble/ciphers/aes.js',
  ])('transpiles the ESM-only dependency at %s', (filePath) => {
    expect(isIgnored(unitPreset.transformIgnorePatterns, filePath)).toBe(false);
  });

  it('still compiles those dependencies with its own transform when ts-jest compiles the TypeScript', async () => {
    const config = await resolveConfig({
      preset: '@frontmcp/testing/jest-preset-unit',
      transform: { '^.+\\.tsx?$': 'ts-jest' },
    });

    expect(transformerFor(config, '/proj/src/server.spec.ts')).toBe(require.resolve('ts-jest'));
    expect(transformerFor(config, '/proj/node_modules/jose/dist/webapi/index.js')).toBe(require.resolve('@swc/jest'));
  });

  it("keeps Jest's default timeout and registers no setup file", () => {
    expect(unitPreset.testTimeout).toBeUndefined();
    expect(unitPreset.setupFilesAfterEnv).toBeUndefined();
  });

  it.each(['/proj/src/tools/add.tool.spec.ts', '/proj/lib/__tests__/badge.spec.tsx'])('runs %s', (filePath) => {
    const matches = globsToMatcher(unitPreset.testMatch.map((glob) => glob.replace('<rootDir>', '/proj')));

    expect(matches(filePath)).toBe(true);
    expect(isIgnored(unitPreset.testPathIgnorePatterns, filePath)).toBe(false);
  });

  it.each([
    '/proj/e2e/server.e2e.spec.ts',
    '/proj/src/load.perf.spec.ts',
    '/proj/src/ui.pw.spec.tsx',
    '/proj/node_modules/pkg/a.spec.ts',
    '/proj/dist/a.spec.ts',
  ])('leaves out %s', (filePath) => {
    expect(isIgnored(unitPreset.testPathIgnorePatterns, filePath)).toBe(true);
  });
});

describe('the @frontmcp/testing build', () => {
  it('ships every file the package exports outside dist', () => {
    const { exports } = require('../../package.json') as { exports: Record<string, { default?: string } | null> };
    const project = require('../../project.json') as {
      targets: { 'build-cjs': { options: { assets: (string | { input: string })[] } } };
    };
    const assets = project.targets['build-cjs'].options.assets;
    const shipped = Object.values(exports)
      .map((target) => target?.default)
      .filter((file): file is string => typeof file === 'string' && !file.startsWith('./dist/'))
      .map((file) => path.posix.join('libs/testing', file));
    const requiredByPresets = ['libs/testing/jest-preset.base.js'];

    expect(assets).toEqual(expect.arrayContaining([...shipped, ...requiredByPresets]));
  });
});
