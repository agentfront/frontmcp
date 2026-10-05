import { EsmInvalidSpecifierError } from '../../errors/esm.errors';
import {
  applyImportMap,
  buildEsmShUrl,
  ESM_SH_BASE_URL,
  importMapPackages,
  isPackageSpecifier,
  parsePackageSpecifier,
} from '../package-specifier';

describe('parsePackageSpecifier', () => {
  it('should parse a scoped package with version range', () => {
    const result = parsePackageSpecifier('@acme/mcp-tools@^1.0.0');
    expect(result).toEqual({
      scope: '@acme',
      name: 'mcp-tools',
      fullName: '@acme/mcp-tools',
      range: '^1.0.0',
      raw: '@acme/mcp-tools@^1.0.0',
    });
  });

  it('should parse an unscoped package with version', () => {
    const result = parsePackageSpecifier('my-tools@2.3.4');
    expect(result).toEqual({
      scope: undefined,
      name: 'my-tools',
      fullName: 'my-tools',
      range: '2.3.4',
      raw: 'my-tools@2.3.4',
    });
  });

  it('should default range to latest when not specified', () => {
    const result = parsePackageSpecifier('my-tools');
    expect(result.range).toBe('latest');
    expect(result.fullName).toBe('my-tools');
  });

  it('should default range to latest for scoped packages', () => {
    const result = parsePackageSpecifier('@acme/tools');
    expect(result.range).toBe('latest');
    expect(result.scope).toBe('@acme');
    expect(result.fullName).toBe('@acme/tools');
  });

  it('should handle tilde ranges', () => {
    const result = parsePackageSpecifier('pkg@~1.2.3');
    expect(result.range).toBe('~1.2.3');
  });

  it('should handle exact versions', () => {
    const result = parsePackageSpecifier('pkg@1.2.3');
    expect(result.range).toBe('1.2.3');
  });

  it('should handle dist tags', () => {
    const result = parsePackageSpecifier('pkg@latest');
    expect(result.range).toBe('latest');
  });

  it('should handle next tag', () => {
    const result = parsePackageSpecifier('pkg@next');
    expect(result.range).toBe('next');
  });

  it('should trim whitespace', () => {
    const result = parsePackageSpecifier('  pkg@1.0.0  ');
    expect(result.name).toBe('pkg');
    expect(result.range).toBe('1.0.0');
  });

  it('should throw for empty string', () => {
    expect(() => parsePackageSpecifier('')).toThrow('cannot be empty');
  });

  it('should throw for whitespace-only string', () => {
    expect(() => parsePackageSpecifier('   ')).toThrow('cannot be empty');
  });

  it('should throw for invalid specifiers', () => {
    expect(() => parsePackageSpecifier('INVALID/BAD NAME')).toThrow('Invalid package specifier');
    expect(() => parsePackageSpecifier('INVALID/BAD NAME')).toThrow(EsmInvalidSpecifierError);
  });
});

describe('isPackageSpecifier', () => {
  it('should return true for valid package specifiers', () => {
    expect(isPackageSpecifier('@acme/tools@^1.0.0')).toBe(true);
    expect(isPackageSpecifier('my-tools')).toBe(true);
    expect(isPackageSpecifier('my-tools@latest')).toBe(true);
  });

  it('should return false for non-package strings', () => {
    expect(isPackageSpecifier('')).toBe(false);
    expect(isPackageSpecifier('INVALID/BAD NAME')).toBe(false);
  });
});

describe('buildEsmShUrl', () => {
  it('should build a bundled URL with resolved version', () => {
    const spec = parsePackageSpecifier('@acme/tools@^1.0.0');
    const url = buildEsmShUrl(spec, '1.2.3');
    expect(url).toBe('https://esm.sh/@acme/tools@1.2.3?bundle');
  });

  it('should use range when no resolved version provided', () => {
    const spec = parsePackageSpecifier('my-tools@^2.0.0');
    const url = buildEsmShUrl(spec);
    expect(url).toBe('https://esm.sh/my-tools@^2.0.0?bundle');
  });

  it('should support custom base URL', () => {
    const spec = parsePackageSpecifier('pkg@1.0.0');
    const url = buildEsmShUrl(spec, '1.0.0', { baseUrl: 'https://custom-cdn.com' });
    expect(url).toBe('https://custom-cdn.com/pkg@1.0.0?bundle');
  });

  it('should omit bundle param when bundle=false', () => {
    const spec = parsePackageSpecifier('pkg@1.0.0');
    const url = buildEsmShUrl(spec, '1.0.0', { bundle: false });
    expect(url).toBe(`${ESM_SH_BASE_URL}/pkg@1.0.0`);
  });
});

describe('import maps (#766)', () => {
  it('marks the remapped packages external in the esm.sh URL', () => {
    const url = buildEsmShUrl(parsePackageSpecifier('@acme/tools@1.0.0'), '1.0.0', {
      external: importMapPackages({ zod: 'https://cdn.example.com/zod.mjs', 'lodash/': 'file:///vendor/lodash/' }),
    });

    expect(url).toBe('https://esm.sh/@acme/tools@1.0.0?bundle&external=lodash,zod');
  });

  it('rewrites exact and prefix specifiers of static and dynamic imports', () => {
    const bundle = [
      'import{z}from"zod";',
      "import chunk from 'lodash/chunk';",
      'export*from"zod/v4";',
      'const lazy=import("zod");',
      'import"left-alone";',
    ].join('\n');

    const rewritten = applyImportMap(bundle, {
      zod: 'https://cdn.example.com/zod.mjs',
      'lodash/': 'file:///vendor/lodash/',
    });

    expect(rewritten).toBe(
      [
        'import{z}from"https://cdn.example.com/zod.mjs";',
        "import chunk from 'file:///vendor/lodash/chunk';",
        'export*from"zod/v4";',
        'const lazy=import("https://cdn.example.com/zod.mjs");',
        'import"left-alone";',
      ].join('\n'),
    );
  });

  it('leaves a bundle alone without an import map', () => {
    expect(applyImportMap('import{z}from"zod";', {})).toBe('import{z}from"zod";');
  });
});
