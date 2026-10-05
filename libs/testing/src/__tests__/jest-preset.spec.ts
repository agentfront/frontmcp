interface JestPreset {
  transform: Record<string, [string, Record<string, unknown>]>;
  moduleNameMapper?: Record<string, string>;
  testMatch: string[];
  transformIgnorePatterns: string[];
}

interface SwcJestTransformer {
  process(
    source: string,
    filename: string,
    options: { supportsStaticESM: boolean; instrument: boolean },
  ): {
    code: string;
  };
}

const preset = require('../../jest-preset.js') as JestPreset;
const [transformerPath, transformerOptions] = preset.transform['^.+\\.[tj]sx?$'];

const isIgnoredByPreset = (filePath: string): boolean =>
  preset.transformIgnorePatterns.some((pattern) => new RegExp(pattern).test(filePath));

describe('@frontmcp/testing/jest-preset', () => {
  it('transforms with the @swc/jest that @frontmcp/testing installs, not ts-jest', () => {
    expect(transformerPath).toBe(require.resolve('@swc/jest'));
    expect(JSON.stringify(preset)).not.toContain('ts-jest');
  });

  it('compiles decorated TypeScript and TSX', () => {
    const { createTransformer } = require(transformerPath) as {
      createTransformer(options: Record<string, unknown>): SwcJestTransformer;
    };
    const source = [
      '@Reflect.metadata("tool", true)',
      'export class Greeter {',
      '  constructor(private readonly name: string) {}',
      '}',
      'export const Badge = () => <span>hi</span>;',
    ].join('\n');

    const { code } = createTransformer(transformerOptions).process(source, 'greeter.tsx', {
      supportsStaticESM: false,
      instrument: false,
    });

    expect(code).toContain('"design:paramtypes"');
    expect(code).toContain('require("react/jsx-runtime")');
  });

  it('maps no @frontmcp/testing paths, which the published package does not have', () => {
    expect(preset.moduleNameMapper).toBeUndefined();
  });

  it.each([
    '/proj/node_modules/jose/dist/webapi/index.js',
    '/proj/node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/index.js',
    '/proj/node_modules/@noble/hashes/sha2.js',
    '/proj/node_modules/.pnpm/@noble+hashes@2.0.1/node_modules/@noble/hashes/sha2.js',
    '/proj/node_modules/@noble/ciphers/aes.js',
    '/proj/node_modules/.pnpm/@noble+ciphers@2.1.1/node_modules/@noble/ciphers/aes.js',
  ])('transpiles the ESM-only dependency at %s, like `frontmcp test`', (filePath) => {
    expect(isIgnoredByPreset(filePath)).toBe(false);
  });

  it('still skips every other dependency', () => {
    expect(isIgnoredByPreset('/proj/node_modules/lodash/index.js')).toBe(true);
    expect(isIgnoredByPreset('/proj/node_modules/.pnpm/lodash@4.17.21/node_modules/lodash/index.js')).toBe(true);
  });

  it('discovers colocated unit specs as well as e2e specs, like `frontmcp test`', () => {
    expect(preset.testMatch).toEqual(
      expect.arrayContaining([
        '<rootDir>/src/**/*.spec.ts',
        '<rootDir>/**/__tests__/**/*.spec.ts',
        '<rootDir>/e2e/**/*.e2e.spec.ts',
      ]),
    );
  });
});
