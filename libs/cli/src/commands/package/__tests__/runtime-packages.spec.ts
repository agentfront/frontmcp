import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { OPTIONAL_RUNTIME_PEERS, resolveRuntimePackageSpecs } from '../runtime-packages';

const SDK_PACKAGE_JSON = path.resolve(__dirname, '../../../../../sdk/package.json');
const UTILS_PACKAGE_JSON = path.resolve(__dirname, '../../../../../utils/package.json');

describe('resolveRuntimePackageSpecs', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-packages-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to the CLI version and its own dependency ranges without a package.json', () => {
    const { required: specs, optional } = resolveRuntimePackageSpecs(dir);
    expect(specs).toHaveLength(4);
    expect(optional).toEqual([]);
    expect(specs[0]).toMatch(/^@frontmcp\/sdk@\d+\.\d+\.\d+/);
    expect(specs[1]).toBe('reflect-metadata@^0.2.2');
    // #679 — the SDK's skill registry loads vectoriadb at start-up, and
    // vectoriadb requires tslib without declaring it.
    expect(specs[2]).toMatch(/^vectoriadb@\^2\./);
    expect(specs[3]).toMatch(/^tslib@\^2\./);
  });

  it('prefers the ranges declared in dependencies', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { '@frontmcp/sdk': '1.8.3', 'reflect-metadata': '^0.2.0', vectoriadb: '2.3.2', tslib: '2.8.1' },
      }),
    );
    expect(resolveRuntimePackageSpecs(dir).required).toEqual([
      '@frontmcp/sdk@1.8.3',
      'reflect-metadata@^0.2.0',
      'vectoriadb@2.3.2',
      'tslib@2.8.1',
    ]);
  });

  it('reads devDependencies and peerDependencies too', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        devDependencies: { '@frontmcp/sdk': '~1.8.0' },
        peerDependencies: { 'reflect-metadata': '0.2.2' },
      }),
    );
    expect(resolveRuntimePackageSpecs(dir).required.slice(0, 2)).toEqual([
      '@frontmcp/sdk@~1.8.0',
      'reflect-metadata@0.2.2',
    ]);
  });

  it('adds the optional SDK peers the project declares, and only those', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { '@frontmcp/storage-sqlite': '1.8.7', '@frontmcp/observability': 'file:./missing', lodash: '4' },
      }),
    );
    const specs = resolveRuntimePackageSpecs(dir).required;
    expect(specs).toContain('@frontmcp/storage-sqlite@1.8.7');
    expect(specs.find((spec) => spec.startsWith('@frontmcp/observability@'))).toMatch(
      /^@frontmcp\/observability@\d+\.\d+\.\d+/,
    );
    expect(specs.some((spec) => spec.startsWith('lodash@'))).toBe(false);
    expect(specs).toHaveLength(6);
  });

  it('keeps an SDK peer declared in optionalDependencies optional', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ optionalDependencies: { '@frontmcp/storage-sqlite': '^1.8.7' } }),
    );
    const { required, optional } = resolveRuntimePackageSpecs(dir);
    expect(optional).toEqual(['@frontmcp/storage-sqlite@^1.8.7']);
    expect(required.some((spec) => spec.startsWith('@frontmcp/storage-sqlite@'))).toBe(false);
  });

  it('prefers optionalDependencies over dependencies for the same name, as npm does', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { '@frontmcp/storage-sqlite': '1.8.0', vectoriadb: '2.3.0' },
        optionalDependencies: { '@frontmcp/storage-sqlite': '1.8.7', vectoriadb: '2.3.2' },
      }),
    );
    const { required, optional } = resolveRuntimePackageSpecs(dir);
    expect(optional).toEqual(['@frontmcp/storage-sqlite@1.8.7']);
    // vectoriadb is needed at start-up: it stays required, at the declared range.
    expect(required).toContain('vectoriadb@2.3.2');
    const all = [...required, ...optional];
    expect(all.some((spec) => spec.endsWith('@1.8.0') || spec.endsWith('@2.3.0'))).toBe(false);
  });

  it('lists every optional peer of @frontmcp/sdk (except vectoriadb) and @frontmcp/utils', () => {
    const optionalPeersOf = (packageJsonPath: string): string[] => {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
        peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      };
      return Object.entries(pkg.peerDependenciesMeta ?? {})
        .filter(([, meta]) => meta.optional)
        .map(([name]) => name);
    };
    const optional = [...new Set([...optionalPeersOf(SDK_PACKAGE_JSON), ...optionalPeersOf(UTILS_PACKAGE_JSON)])]
      .filter((name) => name !== 'vectoriadb')
      .sort();
    expect([...OPTIONAL_RUNTIME_PEERS].sort()).toEqual(optional);
  });

  it('ignores an unparsable package.json', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{not json');
    expect(resolveRuntimePackageSpecs(dir).required[1]).toBe('reflect-metadata@^0.2.2');
  });

  it('anchors a relative file: target to the project directory', () => {
    fs.mkdirSync(path.join(dir, 'vendor', 'sdk'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { '@frontmcp/sdk': 'file:./vendor/sdk' } }),
    );
    expect(resolveRuntimePackageSpecs(dir).required[0]).toBe(`@frontmcp/sdk@file:${path.join(dir, 'vendor', 'sdk')}`);
  });

  it('falls back to the default range for workspace:, link: and missing file: targets', () => {
    for (const range of ['workspace:*', 'link:../sdk', 'file:./missing']) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { '@frontmcp/sdk': range } }));
      expect(resolveRuntimePackageSpecs(dir).required[0]).toMatch(/^@frontmcp\/sdk@\d+\.\d+\.\d+/);
    }
  });

  it('keeps git and remote specs unchanged', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { '@frontmcp/sdk': 'git+https://github.com/acme/sdk.git#v1' } }),
    );
    expect(resolveRuntimePackageSpecs(dir).required[0]).toBe('@frontmcp/sdk@git+https://github.com/acme/sdk.git#v1');
  });
});
