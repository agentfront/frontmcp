/**
 * The `file-watcher` channel source: while the channel is connected, the framework watches the declared paths with
 * `watchFiles` and hands each file event to `onEvent()`. The declared `paths` and `events` were only a label before:
 * nothing was watched, and the channel had to watch in `onConnect()` itself.
 */
import 'reflect-metadata';

import { getRuntimeContext, watchFiles, type FileWatchEvent, type WatchFilesOptions } from '@frontmcp/utils';

import { type DirectClient } from '../../direct/client.types';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  App,
  Channel,
  ChannelContext,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  type ChannelFileEvent,
  type ChannelFileWatcherSource,
  type ChannelNotification,
  type ChannelType,
  type FrontMcpConfigInput,
  type LogRecord,
  type ScopeEntry,
} from '../../index';
import { type ChannelInstance } from '../channel.instance';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext), watchFiles: jest.fn() };
});

/** One watch the framework started: what it asked for, and a way to report a file event on it. */
interface StartedWatch {
  paths: string | string[];
  options: WatchFilesOptions;
  report(event: FileWatchEvent): void;
}

const startedWatches: StartedWatch[] = [];

/** A `watchFiles` the test feeds: it yields what `report()` is given, until its signal aborts. */
function fedWatch(paths: string | string[], options: WatchFilesOptions = {}): AsyncGenerator<FileWatchEvent, void> {
  const pending: FileWatchEvent[] = [];
  let wake = (): void => undefined;
  /** Queues a file event and wakes the watch. */
  const report = (event: FileWatchEvent): void => {
    pending.push(event);
    wake();
  };
  startedWatches.push({ paths, options, report });
  options.signal?.addEventListener('abort', () => wake());

  /** Yields the reported events in order. */
  async function* reported(): AsyncGenerator<FileWatchEvent, void> {
    while (!options.signal?.aborted) {
      const event = pending.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }
  return reported();
}

/** A `watchFiles` that fails as soon as it is iterated. */
async function* failingWatch(): AsyncGenerator<FileWatchEvent, void> {
  throw new Error('EMFILE: too many open files, watch');
}

const logLines: Array<{ level: string; message: string }> = [];

/** Keeps what the server logs. */
@LogTransport({ name: 'FileWatcherCapture', description: 'Captures log lines' })
class CaptureLogTransport extends LogTransportInterface {
  /** Keeps the level and the message of one log record. */
  log(record: LogRecord): void {
    logLines.push({ level: record.levelName, message: record.message });
  }
}

const connections: string[] = [];
const handled: unknown[] = [];
let pushFromOwnWatcher: ((payload: unknown) => void) | undefined;

/** A channel that declares its paths and also keeps a watcher of its own. */
@Channel({
  name: 'logs',
  source: { type: 'file-watcher', paths: ['/var/log/app.log', './inbox'], events: ['change', 'create'] },
})
class LogsChannel extends ChannelContext {
  /** Starts a watcher of its own, as a channel written before 1.12 does. */
  override async onConnect(): Promise<void> {
    connections.push('connect');
    pushFromOwnWatcher = (payload) => this.pushIncoming(payload);
  }

  /** Stops its own watcher. */
  override async onDisconnect(): Promise<void> {
    connections.push('disconnect');
    pushFromOwnWatcher = undefined;
  }

  /** Records the payload and names what happened. */
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    handled.push(payload);
    const { event, path } = payload as ChannelFileEvent;
    return { content: `${event} ${path}` };
  }
}

/** A file-watcher channel named `name` that records what it handles. */
function watcherChannel(name: string, source: Omit<ChannelFileWatcherSource, 'type'>): ChannelType {
  /** Declares its paths, and has no watcher of its own. */
  @Channel({ name, source: { type: 'file-watcher', ...source } })
  class WatcherChannel extends ChannelContext {
    /** Records the payload under the channel's name. */
    async onEvent(payload: unknown): Promise<ChannelNotification> {
      handled.push({ channel: name, payload });
      return { content: name };
    }
  }
  return WatcherChannel;
}

/** The config of a server with the given channels, whose warnings and errors are captured. */
function configWith(channels: ChannelType[]): FrontMcpConfigInput {
  /** The app that declares the channels. */
  @App({ id: 'files', name: 'Files', channels })
  class FilesApp {}
  return {
    info: { name: 'channel-file-watcher', version: '1.0.0' },
    apps: [FilesApp],
    logging: { level: LogLevel.Warn, enableConsole: false, transports: [CaptureLogTransport] },
    channels: { enabled: true },
  };
}

/** A registered channel of a server. */
function channelOf(server: DirectMcpServer, name: string): ChannelInstance {
  const channel = (server as unknown as { scope: ScopeEntry }).scope.channels?.findByName(name);
  if (!channel) throw new Error(`channel ${name} is not registered`);
  return channel;
}

/** Wait for fire-and-forget channel deliveries. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/** What the server logged about its channels at a level. */
function logged(level: string): string[] {
  const aboutChannels = logLines.filter((line) => line.level === level && line.message.startsWith('Channel "'));
  return aboutChannels.map((line) => line.message);
}

describe('file-watcher source', () => {
  let server: DirectMcpServer | undefined;

  beforeEach(() => {
    startedWatches.length = 0;
    logLines.length = 0;
    connections.length = 0;
    handled.length = 0;
    jest.mocked(watchFiles).mockReset();
    jest.mocked(watchFiles).mockImplementation(fedWatch);
    jest.mocked(getRuntimeContext).mockReset();
    jest.mocked(getRuntimeContext).mockImplementation(jest.requireActual('@frontmcp/utils').getRuntimeContext);
  });

  afterEach(async () => {
    await server?.dispose();
    server = undefined;
  });

  it('watches the declared paths for the declared events once the channel is connected', async () => {
    server = await FrontMcpInstance.createDirect(configWith([LogsChannel]));

    expect(connections).toEqual(['connect']);
    expect(startedWatches).toHaveLength(1);
    expect(startedWatches[0].paths).toEqual(['/var/log/app.log', './inbox']);
    expect(startedWatches[0].options.events).toEqual(['change', 'add']);
    expect(startedWatches[0].options.signal?.aborted).toBe(false);
  });

  it.each<[string, ChannelFileWatcherSource['events'], WatchFilesOptions['events']]>([
    ['every event when none is declared', undefined, undefined],
    ['a removal and an arrival for rename', ['rename'], ['add', 'unlink']],
    ['each event once', ['delete', 'rename', 'create'], ['unlink', 'add']],
  ])('watches for %s', async (_label, declared, watched) => {
    server = await FrontMcpInstance.createDirect(
      configWith([watcherChannel('drops', { paths: ['./drop'], events: declared })]),
    );

    expect(startedWatches).toHaveLength(1);
    expect(startedWatches[0].options.events).toEqual(watched);
  });

  it('hands each file event to onEvent() as { event, path }, and sends its notification', async () => {
    server = await FrontMcpInstance.createDirect(configWith([LogsChannel]));
    const client: DirectClient = await server.connect({ capabilities: { experimental: { 'claude/channel': {} } } });
    const received: unknown[] = [];
    client.onNotification((notification) => {
      if (notification.method === 'notifications/claude/channel') received.push(notification.params);
    });

    startedWatches[0].report({ type: 'add', path: '/work/inbox/report.csv' });
    startedWatches[0].report({ type: 'change', path: '/var/log/app.log' });
    startedWatches[0].report({ type: 'unlink', path: '/work/inbox/report.csv' });
    await settle();

    expect(handled).toEqual([
      { event: 'create', path: '/work/inbox/report.csv' },
      { event: 'change', path: '/var/log/app.log' },
      { event: 'delete', path: '/work/inbox/report.csv' },
    ]);
    expect(received).toEqual([
      { content: 'create /work/inbox/report.csv', meta: { source: 'logs' } },
      { content: 'change /var/log/app.log', meta: { source: 'logs' } },
      { content: 'delete /work/inbox/report.csv', meta: { source: 'logs' } },
    ]);
    await client.close();
  });

  it('keeps a channel that watches by itself working beside its own watch: onConnect(), pushIncoming(), onDisconnect()', async () => {
    server = await FrontMcpInstance.createDirect(configWith([LogsChannel]));

    pushFromOwnWatcher?.({ event: 'change', path: '/own/watcher.log' });
    startedWatches[0].report({ type: 'change', path: '/var/log/app.log' });
    await settle();
    await server.dispose();
    server = undefined;

    expect(handled).toEqual([
      { event: 'change', path: '/own/watcher.log' },
      { event: 'change', path: '/var/log/app.log' },
    ]);
    expect(connections).toEqual(['connect', 'disconnect']);
  });

  it('ends the watch when the channel disconnects', async () => {
    server = await FrontMcpInstance.createDirect(configWith([LogsChannel]));
    const { signal } = startedWatches[0].options;

    await channelOf(server, 'logs').disconnectService();

    expect(signal?.aborted).toBe(true);
    expect(connections).toEqual(['connect', 'disconnect']);
  });

  it('ends the watch when the server is disposed', async () => {
    server = await FrontMcpInstance.createDirect(configWith([LogsChannel]));
    const { signal } = startedWatches[0].options;

    await server.dispose();
    server = undefined;

    expect(signal?.aborted).toBe(true);
  });

  it.each([
    ['a serverless deployment', { runtime: 'node', deployment: 'serverless' }],
    ['the edge', { runtime: 'edge', deployment: 'standalone' }],
    ['a browser', { runtime: 'browser', deployment: 'browser' }],
  ])('watches nothing in %s, says so, and still connects the channel', async (_label, runtimeContext) => {
    jest.mocked(getRuntimeContext).mockReturnValue(runtimeContext as never);

    server = await FrontMcpInstance.createDirect(configWith([LogsChannel]));

    expect(watchFiles).not.toHaveBeenCalled();
    expect(connections).toEqual(['connect']);
    expect(logged('warn')).toEqual([
      'Channel "logs" does not watch its paths in a serverless, edge or browser runtime: ' +
        'watching files needs a long-lived process',
    ]);
  });

  it('watches nothing when a build boots the server only to read it: such a boot connects no channel', async () => {
    const read = await FrontMcpInstance.createForManifest(configWith([LogsChannel]));
    await read.shutdown();

    expect(watchFiles).not.toHaveBeenCalled();
    expect(connections).toEqual([]);
  });

  it('logs a watch that fails, and keeps the server and the other channels running', async () => {
    jest.mocked(watchFiles).mockImplementationOnce(failingWatch);

    server = await FrontMcpInstance.createDirect(
      configWith([watcherChannel('broken', { paths: ['./broken'] }), watcherChannel('drops', { paths: ['./drop'] })]),
    );
    await settle();
    startedWatches[0].report({ type: 'add', path: '/work/drop/a.txt' });
    await settle();

    expect(logged('error')).toEqual(['Channel "broken" stopped watching its paths']);
    expect(startedWatches.map((watch) => watch.paths)).toEqual([['./drop']]);
    expect(handled).toEqual([{ channel: 'drops', payload: { event: 'create', path: '/work/drop/a.txt' } }]);
  });

  it('warns that a path with a wildcard is not expanded, and watches it as written', async () => {
    server = await FrontMcpInstance.createDirect(
      configWith([watcherChannel('globbed', { paths: ['./logs/*.log', './logs'] })]),
    );

    expect(logged('warn')).toEqual([
      'Channel "globbed" declares "./logs/*.log": a file-watcher path is not expanded as a glob. ' +
        'Declare the directory to watch its direct files.',
    ]);
    expect(startedWatches.map((watch) => watch.paths)).toEqual([['./logs/*.log', './logs']]);
  });
});
