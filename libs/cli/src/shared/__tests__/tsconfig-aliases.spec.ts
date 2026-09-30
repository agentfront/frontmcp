import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { buildEmittedAliases, readTsPathAliases } from '../tsconfig-aliases';

describe('buildEmittedAliases', () => {
  const entryDir = '/ws/servers/gw/src';
  const emittedEntryDir = '/ws/servers/gw/dist/vercel/servers/gw/src';
  const alwaysExists = () => true;

  it('maps an exact alias to the emitted file mirrored under outDir', () => {
    const result = buildEmittedAliases(
      { basePath: '/ws', paths: { '@scope/shared': ['libs/group/shared/src/index.ts'] } },
      entryDir,
      emittedEntryDir,
      alwaysExists,
    );
    expect(result).toEqual({
      '@scope/shared$': '/ws/servers/gw/dist/vercel/libs/group/shared/src/index.js',
    });
  });

  it.each([
    ['index.mts', 'index.mjs'],
    ['index.cts', 'index.cjs'],
  ])('maps a %s target to the %s tsc emits', (source, emittedName) => {
    const result = buildEmittedAliases(
      { basePath: '/ws', paths: { '@scope/shared': [`libs/shared/src/${source}`] } },
      entryDir,
      emittedEntryDir,
      alwaysExists,
    );
    expect(result).toEqual({ '@scope/shared$': `/ws/servers/gw/dist/vercel/libs/shared/src/${emittedName}` });
  });

  it('maps a wildcard alias to the emitted directory', () => {
    const result = buildEmittedAliases(
      { basePath: '/ws', paths: { '@scope/utils/*': ['libs/utils/src/*'] } },
      entryDir,
      emittedEntryDir,
      alwaysExists,
    );
    expect(result).toEqual({ '@scope/utils': '/ws/servers/gw/dist/vercel/libs/utils/src' });
  });

  it('resolves a directory target to its index file', () => {
    const result = buildEmittedAliases(
      { basePath: '/ws', paths: { '@scope/dir': ['libs/dir/src'] } },
      entryDir,
      emittedEntryDir,
      (file) => file.endsWith('/index.js'),
    );
    expect(result['@scope/dir$']).toBe('/ws/servers/gw/dist/vercel/libs/dir/src/index.js');
  });

  it('resolves an extensionless file target to the emitted file before the directory', () => {
    const emittedFile = '/ws/servers/gw/dist/vercel/libs/shared/src/index.js';
    const result = buildEmittedAliases(
      { basePath: '/ws', paths: { '@scope/shared': ['libs/shared/src/index'] } },
      entryDir,
      emittedEntryDir,
      (file) => file === emittedFile,
    );
    expect(result).toEqual({ '@scope/shared$': emittedFile });
  });

  it('skips aliases whose emitted output does not exist and tries the next target', () => {
    const result = buildEmittedAliases(
      { basePath: '/ws', paths: { '@scope/a': ['libs/missing/src/index.ts', 'libs/a/src/index.ts'] } },
      entryDir,
      emittedEntryDir,
      (file) => file.includes('/libs/a/'),
    );
    expect(result).toEqual({ '@scope/a$': '/ws/servers/gw/dist/vercel/libs/a/src/index.js' });
  });

  it('returns nothing when no target was emitted', () => {
    expect(
      buildEmittedAliases(
        { basePath: '/ws', paths: { '@x/y': ['libs/y/src/index.ts'] } },
        entryDir,
        emittedEntryDir,
        () => false,
      ),
    ).toEqual({});
  });
});

describe('readTsPathAliases', () => {
  let dir: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ts-aliases-')));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('follows extends and reports the base path of the paths map', () => {
    mkdirSync(path.join(dir, 'apps', 'a'), { recursive: true });
    writeFileSync(
      path.join(dir, 'tsconfig.base.json'),
      `{ // comments are allowed in tsconfig\n "compilerOptions": { "baseUrl": ".", "paths": { "@x/y": ["libs/y/src/index.ts"] } } }`,
    );
    const child = path.join(dir, 'apps', 'a', 'tsconfig.json');
    writeFileSync(child, JSON.stringify({ extends: '../../tsconfig.base.json' }));

    const result = readTsPathAliases(child, process.cwd());
    expect(result?.paths).toEqual({ '@x/y': ['libs/y/src/index.ts'] });
    expect(result?.basePath && realpathSync(result.basePath)).toBe(dir);
  });

  it('resolves paths against baseUrl when it is set, as tsc does', () => {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    const file = path.join(dir, 'tsconfig.json');
    writeFileSync(
      file,
      JSON.stringify({ compilerOptions: { baseUrl: './src', paths: { '@shared': ['shared/index.ts'] } } }),
    );

    const result = readTsPathAliases(file, process.cwd());
    expect(result?.basePath && realpathSync(result.basePath)).toBe(path.join(dir, 'src'));
  });

  it('returns undefined when the project declares no aliases', () => {
    const file = path.join(dir, 'tsconfig.json');
    writeFileSync(file, '{ "compilerOptions": {} }');
    expect(readTsPathAliases(file, process.cwd())).toBeUndefined();
  });

  it('returns undefined for an unreadable tsconfig', () => {
    expect(readTsPathAliases(path.join(dir, 'missing.json'), process.cwd())).toBeUndefined();
  });
});
