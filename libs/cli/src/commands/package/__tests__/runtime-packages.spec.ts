import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resolveRuntimePackageSpecs } from '../runtime-packages';

describe('resolveRuntimePackageSpecs', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-packages-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to the CLI version and a reflect-metadata range without a package.json', () => {
    const specs = resolveRuntimePackageSpecs(dir);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatch(/^@frontmcp\/sdk@\d+\.\d+\.\d+/);
    expect(specs[1]).toBe('reflect-metadata@^0.2.2');
  });

  it('prefers the ranges declared in dependencies', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { '@frontmcp/sdk': '1.8.3', 'reflect-metadata': '^0.2.0' } }),
    );
    expect(resolveRuntimePackageSpecs(dir)).toEqual(['@frontmcp/sdk@1.8.3', 'reflect-metadata@^0.2.0']);
  });

  it('reads devDependencies and peerDependencies too', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        devDependencies: { '@frontmcp/sdk': '~1.8.0' },
        peerDependencies: { 'reflect-metadata': '0.2.2' },
      }),
    );
    expect(resolveRuntimePackageSpecs(dir)).toEqual(['@frontmcp/sdk@~1.8.0', 'reflect-metadata@0.2.2']);
  });

  it('ignores an unparsable package.json', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{not json');
    expect(resolveRuntimePackageSpecs(dir)[1]).toBe('reflect-metadata@^0.2.2');
  });

  it('anchors a relative file: target to the project directory', () => {
    fs.mkdirSync(path.join(dir, 'vendor', 'sdk'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { '@frontmcp/sdk': 'file:./vendor/sdk' } }),
    );
    expect(resolveRuntimePackageSpecs(dir)[0]).toBe(`@frontmcp/sdk@file:${path.join(dir, 'vendor', 'sdk')}`);
  });

  it('falls back to the default range for workspace:, link: and missing file: targets', () => {
    for (const range of ['workspace:*', 'link:../sdk', 'file:./missing']) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { '@frontmcp/sdk': range } }));
      expect(resolveRuntimePackageSpecs(dir)[0]).toMatch(/^@frontmcp\/sdk@\d+\.\d+\.\d+/);
    }
  });

  it('keeps git and remote specs unchanged', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { '@frontmcp/sdk': 'git+https://github.com/acme/sdk.git#v1' } }),
    );
    expect(resolveRuntimePackageSpecs(dir)[0]).toBe('@frontmcp/sdk@git+https://github.com/acme/sdk.git#v1');
  });
});
