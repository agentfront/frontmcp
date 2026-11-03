import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createMemoryStorage } from '@frontmcp/utils';

import { prepareSharedDirectory, sharedServerFiles } from '../shared-files';
import { holdStartLock, openStartLockStorage, SharedStartLock } from '../start-lock';

describe('SharedStartLock', () => {
  it('lets one launcher of a key hold it until that one releases it', async () => {
    const storage = createMemoryStorage();
    await storage.connect();
    const first = new SharedStartLock(storage, 'notes');
    const second = new SharedStartLock(storage, 'notes');
    const otherKey = new SharedStartLock(storage, 'calendar');

    expect(await first.acquire()).toBe(true);
    expect(await second.acquire()).toBe(false);
    expect(await otherKey.acquire()).toBe(true);
    expect(await first.renew()).toBe(true);
    expect(await second.renew()).toBe(false);

    await second.release();
    expect(await second.acquire()).toBe(false);
    await first.release();
    expect(await second.acquire()).toBe(true);
    expect(await first.renew()).toBe(false);
  });

  it('passes to another launcher once a holder that died stops renewing it', async () => {
    const storage = createMemoryStorage();
    await storage.connect();
    const dead = new SharedStartLock(storage, 'notes', 1);
    const next = new SharedStartLock(storage, 'notes', 1);

    expect(await dead.acquire()).toBe(true);
    expect(await next.acquire()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(await next.acquire()).toBe(true);
  });

  const posixOnly = process.platform === 'win32' ? it.skip : it;

  async function inSharedHome(run: (files: ReturnType<typeof sharedServerFiles>) => Promise<void>): Promise<void> {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-lock-'));
    const previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    try {
      const files = sharedServerFiles('notes');
      await prepareSharedDirectory(files);
      await run(files);
    } finally {
      if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
      else process.env['FRONTMCP_HOME'] = previousHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  posixOnly("keeps a launcher's lock past its TTL for the server it started, until that server releases it", () =>
    inSharedHome(async (files) => {
      const storage = await openStartLockStorage(files);
      try {
        const launcher = new SharedStartLock(storage, 'notes', 1);
        const next = new SharedStartLock(storage, 'notes', 1);
        expect(await launcher.acquire()).toBe(true);

        const server = await holdStartLock(files, 'notes', launcher.holder, 1);
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        expect(await next.acquire()).toBe(false);
        expect(await server.held()).toBe(true);

        await server.release();
        expect(await next.acquire()).toBe(true);
      } finally {
        await storage.disconnect();
      }
    }),
  );

  posixOnly('tells a server that another launcher took its lock, even once that one let go of it', () =>
    inSharedHome(async (files) => {
      const storage = await openStartLockStorage(files);
      try {
        const launcher = new SharedStartLock(storage, 'notes');
        expect(await launcher.acquire()).toBe(true);
        await launcher.release();
        const other = new SharedStartLock(storage, 'notes');
        expect(await other.acquire()).toBe(true);

        const server = await holdStartLock(files, 'notes', launcher.holder);
        expect(await server.held()).toBe(false);
        await other.release();
        expect(await server.held()).toBe(false);
        await server.release();
      } finally {
        await storage.disconnect();
      }
    }),
  );

  posixOnly('keeps the lock in an owner-only SQLite file every launcher of the key opens', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-lock-'));
    const previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    const files = sharedServerFiles('notes');
    try {
      await prepareSharedDirectory(files);
      const [one, two] = await Promise.all([openStartLockStorage(files), openStartLockStorage(files)]);
      try {
        expect(fs.statSync(files.lockFile).mode & 0o777).toBe(0o600);
        const results = await Promise.all([
          new SharedStartLock(one, 'notes').acquire(),
          new SharedStartLock(two, 'notes').acquire(),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
      } finally {
        await one.disconnect();
        await two.disconnect();
      }
    } finally {
      if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
      else process.env['FRONTMCP_HOME'] = previousHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
