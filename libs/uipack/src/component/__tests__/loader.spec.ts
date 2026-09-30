/**
 * Loader Tests — `resolveUISource` / `resolveFileSource`.
 *
 * Issue #444 coverage: the friendly error wording when a relative `.tsx`/`.jsx`
 * FileSource path resolves against `process.cwd()` and the file isn't there.
 */

import type { FileSource } from '../types';

// Mock fs/path/esbuild so resolveFileSource doesn't touch the real workspace.
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  existsSync: jest.fn(() => false),
}));

jest.mock('path', () => {
  const actual = jest.requireActual('path') as typeof import('path');
  return {
    ...actual,
    isAbsolute: jest.fn(actual.isAbsolute),
    resolve: jest.fn(actual.resolve),
  };
});

jest.mock('esbuild', () => ({
  buildSync: jest.fn(() => ({ outputFiles: [{ text: 'export default function Widget(){}' }] })),
  transformSync: jest.fn(),
}));

// Mock the @frontmcp/ui availability preflight so bundling never short-circuits.
jest.mock('../ui-availability', () => ({
  isFrontmcpUiResolvable: () => true,
}));

describe('resolveFileSource — relative .tsx/.jsx FileSource (#444)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws a friendly error mentioning process.cwd() and the import.meta.url workaround', () => {
    const fs = require('fs');
    const path = require('path');
    (path.isAbsolute as jest.Mock).mockReturnValue(false);
    (path.resolve as jest.Mock).mockReturnValue('/some-cwd/foo.widget.tsx');
    const enoent: NodeJS.ErrnoException = Object.assign(
      new Error("ENOENT: no such file or directory, open '/some-cwd/foo.widget.tsx'"),
      { code: 'ENOENT' as const },
    );
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw enoent;
    });

    const { resolveUISource } = require('../loader');
    const source: FileSource = { file: './foo.widget.tsx' };

    expect(() => resolveUISource(source)).toThrow(/FileSource widget "\.\/foo\.widget\.tsx" not found/);
    expect(() => resolveUISource(source)).toThrow(/resolved against process\.cwd\(\)/);
    expect(() => resolveUISource(source)).toThrow(/fileURLToPath\(new URL\('\.\/widget\.tsx', import\.meta\.url\)\)/);
    expect(() => resolveUISource(source)).toThrow(/issue #444/);
  });

  it('rethrows non-ENOENT errors unchanged', () => {
    const fs = require('fs');
    const path = require('path');
    (path.isAbsolute as jest.Mock).mockReturnValue(false);
    (path.resolve as jest.Mock).mockReturnValue('/some-cwd/foo.widget.tsx');
    const eperm: NodeJS.ErrnoException = Object.assign(new Error('EACCES'), { code: 'EACCES' as const });
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw eperm;
    });

    const { resolveUISource } = require('../loader');
    const source: FileSource = { file: './foo.widget.tsx' };
    expect(() => resolveUISource(source)).toThrow(/EACCES/);
    expect(() => resolveUISource(source)).not.toThrow(/process\.cwd/);
  });

  it('does NOT emit the cwd-relative hint when the user already passed an absolute path', () => {
    const fs = require('fs');
    const path = require('path');
    (path.isAbsolute as jest.Mock).mockReturnValue(true);
    const enoent: NodeJS.ErrnoException = Object.assign(
      new Error("ENOENT: no such file or directory, open '/abs/path/foo.widget.tsx'"),
      { code: 'ENOENT' as const },
    );
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw enoent;
    });

    const { resolveUISource } = require('../loader');
    const source: FileSource = { file: '/abs/path/foo.widget.tsx' };
    expect(() => resolveUISource(source)).toThrow(/ENOENT/);
    expect(() => resolveUISource(source)).not.toThrow(/process\.cwd/);
  });
});

describe('resolveFileSource — absolute .tsx/.jsx FileSource that is missing (#649)', () => {
  const enoentFor = (file: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), { code: 'ENOENT' as const });

  function missing(file: string, existing: string[] = []) {
    const fs = require('fs');
    const path = require('path');
    (path.isAbsolute as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw enoentFor(file);
    });
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => existing.includes(p));
    const { resolveUISource } = require('../loader');
    try {
      resolveUISource({ file });
    } catch (err) {
      return err as NodeJS.ErrnoException;
    }
    throw new Error('expected resolveUISource to throw');
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('names the path, keeps ENOENT, and explains when the file is read and that tsc does not copy it', () => {
    const err = missing('/proj/lib/queue.widget.tsx');

    expect(err.message).toContain('"/proj/lib/queue.widget.tsx"');
    expect(err.message).toMatch(/ENOENT/);
    expect(err.code).toBe('ENOENT');
    expect(err.message).toMatch(/read from this path when the tool is called/);
    expect(err.message).toMatch(/tsc does not copy `\*\.widget\.tsx`/);
    expect(err.message).toMatch(/frontmcp build/);
    expect(err.message).not.toMatch(/source widget exists at/);
  });

  it('names the source file when the path is in dist/ and the same relative path exists under src/', () => {
    const err = missing('/proj/dist/tools/queue.widget.tsx', ['/proj/src/tools/queue.widget.tsx']);

    expect(err.message).toContain('The source widget exists at "/proj/src/tools/queue.widget.tsx"');
  });

  it('also looks past a per-target directory such as dist/node/', () => {
    const err = missing('/proj/dist/node/queue.widget.tsx', ['/proj/src/queue.widget.tsx']);

    expect(err.message).toContain('The source widget exists at "/proj/src/queue.widget.tsx"');
  });

  it('names the file next to the build directory when tsc compiles from the project root', () => {
    const err = missing('/proj/dist/queue.widget.tsx', ['/proj/queue.widget.tsx']);

    expect(err.message).toContain('The source widget exists at "/proj/queue.widget.tsx"');
  });

  it('prefers the src/ file over one next to the build directory', () => {
    const err = missing('/proj/dist/queue.widget.tsx', ['/proj/queue.widget.tsx', '/proj/src/queue.widget.tsx']);

    expect(err.message).toContain('The source widget exists at "/proj/src/queue.widget.tsx"');
  });

  it('checks build/ and out/ directories too', () => {
    expect(missing('/proj/build/queue.widget.jsx', ['/proj/src/queue.widget.jsx']).message).toContain(
      '"/proj/src/queue.widget.jsx"',
    );
    expect(missing('/proj/out/queue.widget.tsx', ['/proj/src/queue.widget.tsx']).message).toContain(
      '"/proj/src/queue.widget.tsx"',
    );
  });

  it('names no source file when none exists', () => {
    const err = missing('/proj/dist/tools/queue.widget.tsx');

    expect(err.message).not.toMatch(/source widget exists at/);
  });
});

describe('resolveUISource — inlineReact plumbing for FileSource (#454)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes inlineReact through to bundleFileSource as bundleReact: true', () => {
    const fs = require('fs');
    const path = require('path');
    (path.isAbsolute as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue('export default function Widget(){}');

    const esbuild = require('esbuild');
    const buildSyncSpy = esbuild.buildSync as jest.Mock;
    buildSyncSpy.mockClear();

    const { resolveUISource } = require('../loader');
    resolveUISource({ file: '/abs/widget.tsx' }, { inlineReact: true });

    const opts = buildSyncSpy.mock.calls[0][0];
    // When inlineReact is true, bundleFileSource passes bundleReact: true,
    // which empties the esbuild `external` array so React is inlined.
    expect(opts.external).toEqual([]);
  });

  it('keeps React external by default (inlineReact unset)', () => {
    const fs = require('fs');
    const path = require('path');
    (path.isAbsolute as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue('export default function Widget(){}');

    const esbuild = require('esbuild');
    const buildSyncSpy = esbuild.buildSync as jest.Mock;
    buildSyncSpy.mockClear();

    const { resolveUISource } = require('../loader');
    resolveUISource({ file: '/abs/widget.tsx' });

    const opts = buildSyncSpy.mock.calls[0][0];
    expect(opts.external).toEqual(['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime']);
  });
});

describe('resolveUISource — transformOnly plumbing for FileSource (#469)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('transpiles single-file (transformSync), keeps imports external, and does NOT bundle', () => {
    const fs = require('fs');
    const path = require('path');
    (path.isAbsolute as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(
      `import React from 'react';\nimport { mountAuthPage } from '@frontmcp/ui/auth';\nexport default function LoginPage(){ return React.createElement('div'); }`,
    );

    const esbuild = require('esbuild');
    const buildSyncSpy = esbuild.buildSync as jest.Mock;
    const transformSyncSpy = esbuild.transformSync as jest.Mock;
    transformSyncSpy.mockReturnValue({
      code: `import React from "react";\nimport { mountAuthPage } from "@frontmcp/ui/auth";\nexport default function LoginPage() { return React.createElement("div"); }`,
    });

    const { resolveUISource } = require('../loader');
    const resolved = resolveUISource({ file: '/abs/login.tsx' }, { transformOnly: true });

    // Transform-only never bundles.
    expect(buildSyncSpy).not.toHaveBeenCalled();
    expect(transformSyncSpy).toHaveBeenCalledTimes(1);
    expect(resolved.bundled).toBe(false);
    expect(resolved.mode).toBe('module');
    expect(resolved.code).toContain('React.createElement');
    expect(resolved.exportName).toBe('LoginPage');
    // External imports from the transpiled source are surfaced for the import map.
    expect(resolved.imports).toEqual(expect.arrayContaining(['react', '@frontmcp/ui/auth']));
  });

  it('honors an explicit exportName in transform-only mode', () => {
    const fs = require('fs');
    const path = require('path');
    (path.isAbsolute as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(`export const Foo = () => null;`);

    const esbuild = require('esbuild');
    (esbuild.transformSync as jest.Mock).mockReturnValue({ code: `export const Foo = () => null;` });

    const { resolveUISource } = require('../loader');
    const resolved = resolveUISource({ file: '/abs/foo.tsx', exportName: 'Foo' }, { transformOnly: true });
    expect(resolved.exportName).toBe('Foo');
    expect(resolved.bundled).toBe(false);
  });

  it('rejects inlineReact + transformOnly together (mutually exclusive, fail fast)', () => {
    const { resolveUISource } = require('../loader');
    expect(() => resolveUISource({ file: '/abs/login.tsx' }, { inlineReact: true, transformOnly: true })).toThrow(
      Error,
    );
    expect(() => resolveUISource({ file: '/abs/login.tsx' }, { inlineReact: true, transformOnly: true })).toThrow(
      /mutually exclusive/,
    );
  });
});
