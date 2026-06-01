import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadBetterSqlite3 } from '../better-sqlite3-loader';
import { openDatabase } from '../open-database';

describe('openDatabase', () => {
  it('opens an in-memory database without touching the filesystem', () => {
    const db = openDatabase(':memory:', 'TestStore');
    try {
      db.exec('CREATE TABLE t (k TEXT);');
      db.prepare('INSERT INTO t (k) VALUES (?)').run('v');
      const row = db.prepare('SELECT k FROM t').get() as { k: string };
      expect(row.k).toBe('v');
    } finally {
      db.close();
    }
  });

  it('creates missing parent directories for a nested file path', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-db-'));
    const nested = path.join(base, 'x', 'y', 'z', 'db.sqlite');
    expect(fs.existsSync(path.dirname(nested))).toBe(false);

    const db = openDatabase(nested, 'TestStore');
    try {
      expect(fs.existsSync(nested)).toBe(true);
    } finally {
      db.close();
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('opens a file in the current directory without attempting to create "."', () => {
    // dirname('db.sqlite') === '.', which must be skipped (no mkdir of '.').
    const cwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'open-db-cwd-'));
    process.chdir(tmp);
    try {
      const db = openDatabase('relative.sqlite', 'TestStore');
      db.close();
      expect(fs.existsSync(path.join(tmp, 'relative.sqlite'))).toBe(true);
    } finally {
      process.chdir(cwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('wraps directory-creation failures with the store name', () => {
    // Privilege-independent failure: put the db path UNDER a real FILE, so the
    // parent directory cannot be created (ENOTDIR) — this fails even as root,
    // unlike "/nonexistent/..." which root can happily create.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-db-fail-'));
    const fileAsParent = path.join(base, 'not-a-dir');
    fs.writeFileSync(fileAsParent, 'x');
    const badPath = path.join(fileAsParent, 'db.sqlite');
    try {
      expect(() => openDatabase(badPath, 'WidenStore')).toThrow(
        /WidenStore: failed to (create directory|open database)/,
      );
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('loadBetterSqlite3', () => {
  it('returns a constructable better-sqlite3 and caches the module', () => {
    const A = loadBetterSqlite3();
    const B = loadBetterSqlite3();
    expect(A).toBe(B);

    const db = new A(':memory:');
    try {
      expect(typeof db.prepare).toBe('function');
    } finally {
      db.close();
    }
  });
});
