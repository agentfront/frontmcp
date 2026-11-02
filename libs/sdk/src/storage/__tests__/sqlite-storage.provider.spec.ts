import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Token } from '@frontmcp/di';
import type { RootStorage } from '@frontmcp/utils';

import { LogLevel } from '../../common';
import { createContainer } from '../../provider/create-container';
import { sqliteStorageProvider, SqliteStorageToken } from '../sqlite-storage.provider';

const quiet = { level: LogLevel.Off, enableConsole: false };

describe('sqliteStorageProvider', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-sqlite-storage-'));
    dbPath = path.join(dir, 'app.sqlite');
  });

  afterEach(() => {
    jest.dontMock('@frontmcp/storage-sqlite');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('provides a SQLite storage under SqliteStorageToken, disconnected at shutdown', async () => {
    const container = await createContainer({ providers: [sqliteStorageProvider({ path: dbPath })], logging: quiet });
    const storage = container.get(SqliteStorageToken);

    expect(await storage.incr('visits')).toBe(1);
    await storage.set('lease', 'mine', { ttlSeconds: 30, ifNotExists: true });
    expect(await storage.deleteIfEquals('lease', 'mine')).toBe(true);

    await container.dispose();
    expect(await storage.ping()).toBe(false);
  });

  it('keeps what it stored for the next process that opens the file', async () => {
    const first = await createContainer({ providers: [sqliteStorageProvider({ path: dbPath })], logging: quiet });
    await first.get(SqliteStorageToken).set('kept', 'yes');
    await first.dispose();

    const second = await createContainer({ providers: [sqliteStorageProvider({ path: dbPath })], logging: quiet });
    expect(await second.get(SqliteStorageToken).get('kept')).toBe('yes');
    await second.dispose();
  });

  it('registers under a token of its own, with a key prefix', async () => {
    const AuditStorage = Symbol('AuditStorage') as Token<RootStorage>;
    const container = await createContainer({
      providers: [sqliteStorageProvider({ path: dbPath, prefix: 'audit:', provide: AuditStorage })],
      logging: quiet,
    });
    const audit = container.get(AuditStorage);

    await audit.set('entry', 'v');
    expect(await audit.root.get('audit:entry')).toBe('v');
    expect(container.tryGet(SqliteStorageToken)).toBeUndefined();
    await container.dispose();
  });

  it('fails the boot on invalid options', async () => {
    await expect(createContainer({ providers: [sqliteStorageProvider({ path: '' })], logging: quiet })).rejects.toThrow(
      /sqlite\.path/,
    );
  });

  it('fails the boot instead of falling back to memory when the package is missing', async () => {
    jest.doMock('@frontmcp/storage-sqlite', () => {
      throw Object.assign(new Error("Cannot find module '@frontmcp/storage-sqlite'"), { code: 'MODULE_NOT_FOUND' });
    });
    await expect(
      createContainer({ providers: [sqliteStorageProvider({ path: dbPath })], logging: quiet }),
    ).rejects.toThrow('npm install @frontmcp/storage-sqlite');
  });
});
