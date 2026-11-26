import 'reflect-metadata';

import {
  App,
  LogLevel,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
} from '../../../common';
import { connect } from '../../../direct/connect';
import { InvalidResourceStoreError } from '../../../errors';
import { MATERIALIZED_META_KEY, MaterializedResourceContext } from '../materialized-resource.context';
import { MaterializedResources } from '../materialized-resources';
import { resourceStore } from '../resource-store';

interface Board {
  open: number;
}

const store = resourceStore({ coalesceMs: 0 });
const board = store.key<Board>('board', { initial: { open: 0 } });
const motd = store.key<string>('motd', { initial: 'hello' });

@Resource({ name: 'board', uri: 'board://status', from: board })
class BoardResource extends MaterializedResourceContext {}

@Resource({ name: 'motd', uri: 'board://motd', from: motd })
class MotdResource extends MaterializedResourceContext {}

@Tool({ name: 'open_ticket', inputSchema: {} })
class OpenTicketTool extends ToolContext {
  async execute() {
    const { revision } = await board.update((current) => ({ open: current.open + 1 }));
    return { revision };
  }
}

@App({ id: 'board', name: 'Board', resources: [BoardResource, MotdResource], tools: [OpenTicketTool] })
class BoardApp {}

function config(): FrontMcpConfigInput {
  return { info: { name: 'materialized', version: '1.0.0' }, apps: [BoardApp], logging: { level: LogLevel.Off } };
}

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('a materialized resource', () => {
  it('reads the stored value as JSON, with its revision and time in _meta', async () => {
    const client = await connect(config());
    try {
      await board.set({ open: 2 });

      const read = await client.readResource('board://status');

      expect(read.contents).toEqual([{ uri: 'board://status', mimeType: 'application/json', text: '{"open":2}' }]);
      expect(read._meta?.[MATERIALIZED_META_KEY]).toEqual({
        revision: (await board.get()).revision,
        updatedAt: expect.any(String),
      });
    } finally {
      await client.close();
    }
  });

  it('reads a string value as plain text, before any write', async () => {
    const client = await connect(config());
    try {
      const read = await client.readResource('board://motd');

      expect(read.contents).toEqual([{ uri: 'board://motd', mimeType: 'text/plain', text: 'hello' }]);
      expect(read._meta?.[MATERIALIZED_META_KEY]).toEqual({ revision: 0 });
    } finally {
      await client.close();
    }
  });

  it('sends resources/updated to a subscribed session when the revision changes, and none once it unsubscribed', async () => {
    const client = await connect(config());
    try {
      const updated: string[] = [];
      client.onResourceUpdated((uri) => updated.push(uri));
      await client.subscribeResource('board://status');

      await client.callTool('open_ticket', {});
      await until(() => updated.length === 1);
      await client.unsubscribeResource('board://status');
      await board.set({ open: 9 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(updated).toEqual(['board://status']);
    } finally {
      await client.close();
    }
  });

  it('tells nothing more to a session that closed, and keeps telling the others', async () => {
    const shared = config();
    const leaving = await connect(shared);
    const staying = await connect(shared);
    try {
      const leavingUpdates: string[] = [];
      const stayingUpdates: string[] = [];
      leaving.onResourceUpdated((uri) => leavingUpdates.push(uri));
      staying.onResourceUpdated((uri) => stayingUpdates.push(uri));
      await leaving.subscribeResource('board://status');
      await staying.subscribeResource('board://status');

      await leaving.close();
      await board.update((current) => ({ open: current.open + 1 }));
      await until(() => stayingUpdates.length === 1);

      expect(leavingUpdates).toEqual([]);
    } finally {
      await staying.close();
    }
  });
});

describe('a materialized resource template', () => {
  const tables = resourceStore({ coalesceMs: 0 }).family<{ rows: number }>('tables', { initial: { rows: 0 } });

  @ResourceTemplate({ name: 'table', uriTemplate: 'tables://{table}/stats', from: tables })
  class TableResource extends MaterializedResourceContext {}

  @App({ id: 'tables', name: 'Tables', resources: [TableResource] })
  class TablesApp {}

  const tablesConfig = (): FrontMcpConfigInput => ({
    info: { name: 'materialized-template', version: '1.0.0' },
    apps: [TablesApp],
    logging: { level: LogLevel.Off },
  });

  it("reads the key of the URI's parameters", async () => {
    const client = await connect(tablesConfig());
    try {
      await tables.key({ table: 'users' }).set({ rows: 3 });

      const users = await client.readResource('tables://users/stats');
      const orders = await client.readResource('tables://orders/stats');

      expect(users.contents).toEqual([
        { uri: 'tables://users/stats', mimeType: 'application/json', text: '{"rows":3}' },
      ]);
      expect(users._meta?.[MATERIALIZED_META_KEY]).toEqual({ revision: 1, updatedAt: expect.any(String) });
      expect(orders.contents[0]).toEqual(expect.objectContaining({ text: '{"rows":0}' }));
    } finally {
      await client.close();
    }
  });

  it('sends resources/updated for a subscribed URI only, and none once it unsubscribed', async () => {
    const client = await connect(tablesConfig());
    try {
      const updated: string[] = [];
      client.onResourceUpdated((uri) => updated.push(uri));
      await client.subscribeResource('tables://users/stats');
      await new Promise((resolve) => setTimeout(resolve, 10));

      await tables.key({ table: 'orders' }).set({ rows: 1 });
      await tables.key({ table: 'users' }).set({ rows: 4 });
      await until(() => updated.length === 1);
      await client.unsubscribeResource('tables://users/stats');
      await tables.key({ table: 'users' }).set({ rows: 5 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(updated).toEqual(['tables://users/stats']);
    } finally {
      await client.close();
    }
  });

  it('refuses a `from` that is not a key family', () => {
    const key = resourceStore().key('one');
    expect(() =>
      ResourceTemplate({ name: 'wrong', uriTemplate: 'wrong://{id}', from: key as never })(
        class extends MaterializedResourceContext {},
      ),
    ).toThrow('key family');
  });
});

describe('a producer-backed resource', () => {
  let runs = 0;
  let open = 0;
  const summary = resourceStore({ coalesceMs: 0 }).key('summary', {
    produce: () => {
      runs++;
      return { open };
    },
    minIntervalMs: 0,
  });

  @Resource({ name: 'summary', uri: 'board://summary', from: summary })
  class SummaryResource extends MaterializedResourceContext {}

  @App({ id: 'summary', name: 'Summary', resources: [SummaryResource] })
  class SummaryApp {}

  it('runs its producer on a read, and on a dirty mark only while a session subscribes', async () => {
    const client = await connect({
      info: { name: 'materialized-producer', version: '1.0.0' },
      apps: [SummaryApp],
      logging: { level: LogLevel.Off },
    });
    try {
      const updated: string[] = [];
      client.onResourceUpdated((uri) => updated.push(uri));
      summary.markDirty();
      summary.markDirty();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(runs).toBe(0);

      const first = await client.readResource('board://summary');
      expect(first.contents[0]).toEqual(expect.objectContaining({ text: '{"open":0}' }));
      expect(runs).toBe(1);

      await client.subscribeResource('board://summary');
      open = 1;
      summary.markDirty();
      await until(() => updated.length === 1);
      summary.markDirty();
      await until(() => runs === 3);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(updated).toEqual(['board://summary']);
      expect((await summary.get()).revision).toBe(2);

      await client.unsubscribeResource('board://summary');
      open = 2;
      summary.markDirty();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(runs).toBe(3);
    } finally {
      await client.close();
    }
  });
});

describe('MaterializedResources', () => {
  interface FakeEntry {
    uri?: string;
    isTemplate?: boolean;
    metadata: object;
    record: object;
    matchUri?: (uri: string) => { matches: boolean; params: Record<string, string> };
  }

  function scopeOf(entries: FakeEntry[]) {
    const listeners: Array<(event: { kind: string }) => void> = [];
    const watchListeners = new Set<() => void>();
    const watched = new Set<string>();
    const notifyContentChanged = jest.fn();
    const setWatched = (uri: string, on: boolean) => {
      if (on) watched.add(uri);
      else watched.delete(uri);
      for (const listener of watchListeners) listener();
    };
    return {
      notifyContentChanged,
      register(entry: FakeEntry) {
        entries.push(entry);
        for (const listener of listeners) listener({ kind: 'added' });
      },
      watch: (uri: string) => setWatched(uri, true),
      unwatch: (uri: string) => setWatched(uri, false),
      scope: {
        logger: { warn: jest.fn() },
        resources: {
          listAllInstances: () => entries,
          subscribe: (_options: object, listener: (event: { kind: string }) => void) => {
            listeners.push(listener);
            return () => listeners.splice(listeners.indexOf(listener), 1);
          },
          notifyContentChanged,
          watchedUris: () => [...watched],
          onWatchChange: (listener: () => void) => {
            watchListeners.add(listener);
            return () => watchListeners.delete(listener);
          },
        },
      },
    };
  }

  it('follows a producer-backed key only while its URI, or a prefix of it, has a subscriber', async () => {
    const own = resourceStore({ coalesceMs: 0 });
    let runs = 0;
    const summary = own.key('summary', { produce: () => ++runs, minIntervalMs: 0 });
    const fake = scopeOf([{ uri: 'n://summary', metadata: { name: 'summary', from: summary }, record: {} }]);
    const watcher = new MaterializedResources(fake.scope as never);
    await watcher.start();

    summary.markDirty();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runs).toBe(0);

    fake.watch('n://');
    await until(() => fake.notifyContentChanged.mock.calls.length === 1);
    summary.markDirty();
    await until(() => fake.notifyContentChanged.mock.calls.length === 2);
    fake.unwatch('n://');
    summary.markDirty();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await watcher.stop();

    expect(runs).toBe(2);
    expect(fake.notifyContentChanged.mock.calls).toEqual([['n://summary'], ['n://summary']]);
  });

  it("follows each subscribed URI of a template, on the key of the URI's parameters", async () => {
    const own = resourceStore({ coalesceMs: 0 });
    const tables = own.family<number>('tables', { initial: 0 });
    const matchUri = (uri: string) => {
      const match = /^t:\/\/([^/]+)$/.exec(uri);
      const params: Record<string, string> = match ? { table: match[1] } : {};
      return { matches: match !== null, params };
    };
    const fake = scopeOf([{ isTemplate: true, metadata: { name: 'tables', from: tables }, record: {}, matchUri }]);
    const watcher = new MaterializedResources(fake.scope as never);
    await watcher.start();

    fake.watch('t://users');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await tables.key({ table: 'orders' }).set(1);
    await tables.key({ table: 'users' }).set(1);
    await until(() => fake.notifyContentChanged.mock.calls.length === 1);
    fake.unwatch('t://users');
    await tables.key({ table: 'users' }).set(2);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await watcher.stop();

    expect(fake.notifyContentChanged.mock.calls).toEqual([['t://users']]);
  });

  it('announces a revision change of each followed key, follows a resource registered later, and stops', async () => {
    const own = resourceStore({ coalesceMs: 0 });
    const first = own.key<number>('first', { initial: 0 });
    const later = own.key<number>('later', { initial: 0 });
    const fake = scopeOf([{ uri: 'n://first', metadata: { name: 'first', from: first }, record: {} }]);
    const watcher = new MaterializedResources(fake.scope as never);
    await watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    await first.set(1);
    await until(() => fake.notifyContentChanged.mock.calls.length === 1);
    fake.register({ uri: 'n://later', metadata: { name: 'later', from: later }, record: {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await later.set(1);
    await until(() => fake.notifyContentChanged.mock.calls.length === 2);
    await watcher.stop();
    await first.set(2);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fake.notifyContentChanged.mock.calls).toEqual([['n://first'], ['n://later']]);
  });

  it('keeps a store open while another scope still serves it', async () => {
    const shared = resourceStore({ coalesceMs: 0 });
    const counter = shared.key<number>('counter', { initial: 0 });
    const first = scopeOf([{ uri: 'n://counter', metadata: { name: 'counter', from: counter }, record: {} }]);
    const second = scopeOf([{ uri: 'n://counter', metadata: { name: 'counter', from: counter }, record: {} }]);
    const firstWatcher = new MaterializedResources(first.scope as never);
    const secondWatcher = new MaterializedResources(second.scope as never);
    await firstWatcher.start();
    await secondWatcher.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    await firstWatcher.stop();
    await counter.set(1);
    await until(() => second.notifyContentChanged.mock.calls.length === 1);
    await secondWatcher.stop();

    expect(first.notifyContentChanged).not.toHaveBeenCalled();
  });

  it('warns when the store of a resource registered later cannot open', async () => {
    const fake = scopeOf([]);
    const watcher = new MaterializedResources(fake.scope as never);
    await watcher.start();
    const broken = resourceStore({ storage: { type: 'sqlite', sqlite: { path: '' } } });

    fake.register({ uri: 'n://broken', metadata: { name: 'broken', from: broken.key('broken') }, record: {} });
    await until(() => fake.scope.logger.warn.mock.calls.length === 1);
    await watcher.stop();

    expect(fake.scope.logger.warn.mock.calls[0][0]).toContain('n://broken');
  });

  it('closes the stores it opened when another one fails to open', async () => {
    const working = resourceStore({ coalesceMs: 0 });
    const close = jest.spyOn(working, 'close');
    const broken = resourceStore({ storage: { type: 'sqlite', sqlite: { path: '' } } });
    const fake = scopeOf([
      { uri: 'n://working', metadata: { name: 'working', from: working.key('working') }, record: {} },
      { uri: 'n://broken', metadata: { name: 'broken', from: broken.key('broken') }, record: {} },
    ]);

    await expect(new MaterializedResources(fake.scope as never).start()).rejects.toThrow('sqlite.path');
    expect(close).toHaveBeenCalled();
  });

  it('keeps the start error when a store also fails to close', async () => {
    const working = resourceStore({ coalesceMs: 0 });
    jest.spyOn(working, 'close').mockRejectedValueOnce(new Error('still busy'));
    const broken = resourceStore({ storage: { type: 'sqlite', sqlite: { path: '' } } });
    const fake = scopeOf([
      { uri: 'n://working', metadata: { name: 'working', from: working.key('working') }, record: {} },
      { uri: 'n://broken', metadata: { name: 'broken', from: broken.key('broken') }, record: {} },
    ]);

    await expect(new MaterializedResources(fake.scope as never).start()).rejects.toThrow('sqlite.path');
    expect(fake.scope.logger.warn).toHaveBeenCalledWith(expect.stringContaining('still busy'));
  });

  it('fails the start when a store cannot open', async () => {
    const broken = resourceStore({ storage: { type: 'sqlite', sqlite: { path: '' } } });
    const fake = scopeOf([{ uri: 'n://broken', metadata: { name: 'broken', from: broken.key('broken') }, record: {} }]);

    await expect(new MaterializedResources(fake.scope as never).start()).rejects.toThrow('sqlite.path');
  });

  it('fails the start for a MaterializedResourceContext class with no `from`', async () => {
    class NoKeyResource extends MaterializedResourceContext {}
    const fake = scopeOf([{ uri: 'n://none', metadata: { name: 'none' }, record: { provide: NoKeyResource } }]);

    await expect(new MaterializedResources(fake.scope as never).start()).rejects.toThrow(InvalidResourceStoreError);
  });

  it('leaves other resources alone', async () => {
    class PlainResource extends ResourceContext {
      async execute() {
        return 'plain';
      }
    }
    const fake = scopeOf([
      { uri: 'n://plain', metadata: { name: 'plain' }, record: { provide: PlainResource } },
      { isTemplate: true, metadata: { name: 'template' }, record: {} },
    ]);
    const watcher = new MaterializedResources(fake.scope as never);

    await expect(watcher.start()).resolves.toBeUndefined();
    await watcher.stop();
  });
});
