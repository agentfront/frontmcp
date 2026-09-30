import * as fs from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { cleanIntermediateFiles } from '../clean-intermediates';

describe('cleanIntermediateFiles', () => {
  let dir: string;
  const old = (Date.now() - 60_000) / 1000;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), 'clean-intermediates-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, ageOld = false) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, 'x');
    if (ageOld) fs.utimesSync(file, old, old);
    return file;
  }

  it('removes files the build just wrote and keeps the whitelist', () => {
    write('main.js');
    write('main.js.map');
    write('app.bundle.js');
    const removed = cleanIntermediateFiles(dir, new Set(['app.bundle.js']), Date.now() - 5000);

    expect(removed).toBe(2);
    expect(fs.readdirSync(dir)).toEqual(['app.bundle.js']);
  });

  it('never deletes project files that predate the build (outDir is the project root)', () => {
    const untouched = ['package.json', 'tsconfig.json', 'frontmcp.config.ts', 'frontmcp.config.js'].map((f) =>
      write(f, true),
    );
    write('main.js');

    cleanIntermediateFiles(dir, new Set(), Date.now() - 5000);

    for (const file of untouched) expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'main.js'))).toBe(false);
  });

  it('keeps markdown files and directories', () => {
    write('README.md');
    fs.mkdirSync(path.join(dir, '_skills'));

    expect(cleanIntermediateFiles(dir, new Set(), Date.now() - 5000)).toBe(0);
    expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '_skills'))).toBe(true);
  });
});
