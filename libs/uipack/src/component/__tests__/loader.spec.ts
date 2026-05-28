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
