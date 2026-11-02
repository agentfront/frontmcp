import 'reflect-metadata';

import { App, LogLevel, Resource, ResourceContext, Tool, ToolContext, type FrontMcpConfigInput } from '../../../common';
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

describe('MaterializedResources', () => {
  function scopeOf(entries: Array<{ uri?: string; isTemplate?: boolean; metadata: object; record: object }>) {
    const listeners: Array<(event: { kind: string }) => void> = [];
    const notifyContentChanged = jest.fn();
    return {
      notifyContentChanged,
      register(entry: (typeof entries)[number]) {
        entries.push(entry);
        for (const listener of listeners) listener({ kind: 'added' });
      },
      scope: {
        logger: { warn: jest.fn() },
        resources: {
          listAllInstances: () => entries,
          subscribe: (_options: object, listener: (event: { kind: string }) => void) => {
            listeners.push(listener);
            return () => listeners.splice(listeners.indexOf(listener), 1);
          },
          notifyContentChanged,
        },
      },
    };
  }

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
