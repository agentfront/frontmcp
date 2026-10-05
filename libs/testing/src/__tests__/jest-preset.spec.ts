interface JestPreset {
  transform: Record<string, [string, Record<string, unknown>]>;
  moduleNameMapper?: Record<string, string>;
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
});
