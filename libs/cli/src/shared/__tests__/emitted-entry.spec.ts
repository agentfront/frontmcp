import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { resolveEmittedEntry } from '../emitted-entry';

describe('resolveEmittedEntry', () => {
  let root: string;
  let outDir: string;
  let entry: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'emitted-entry-'));
    outDir = path.join(root, 'apps', 'demo', 'dist');
    entry = path.join(root, 'apps', 'demo', 'src', 'main.ts');
    mkdirSync(outDir, { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const emit = (relative: string) => {
    const file = path.join(outDir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '');
    return file;
  };

  it('finds the entry flat under outDir when the sources are rooted at the entry folder', () => {
    const file = emit('main.js');
    expect(resolveEmittedEntry(outDir, entry)).toEqual({ compiledEntry: file, emittedEntryDir: outDir });
  });

  it('finds the entry under the mirrored path when tsc rooted the output at the workspace', () => {
    const file = emit(path.join('apps', 'demo', 'src', 'main.js'));
    expect(resolveEmittedEntry(outDir, entry)).toEqual({
      compiledEntry: file,
      emittedEntryDir: path.join(outDir, 'apps', 'demo', 'src'),
    });
  });

  it('finds the entry when tsc rooted the output at the project (a lib sits beside src)', () => {
    const file = emit(path.join('src', 'main.js'));
    expect(resolveEmittedEntry(outDir, entry).compiledEntry).toBe(file);
  });

  it('prefers the flat layout when both layouts exist', () => {
    emit('main.js');
    emit(path.join('apps', 'demo', 'src', 'main.js'));
    expect(resolveEmittedEntry(outDir, entry).compiledEntry).toBe(path.join(outDir, 'main.js'));
  });

  it('falls back to the flat location when nothing was emitted', () => {
    expect(resolveEmittedEntry(outDir, entry)).toEqual({
      compiledEntry: path.join(outDir, 'main.js'),
      emittedEntryDir: outDir,
    });
  });

  it('maps .tsx entries to .js', () => {
    const tsxEntry = path.join(root, 'apps', 'demo', 'src', 'main.tsx');
    const file = emit('main.js');
    expect(resolveEmittedEntry(outDir, tsxEntry).compiledEntry).toBe(file);
  });
});
