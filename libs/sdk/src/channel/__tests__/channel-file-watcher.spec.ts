/**
 * The `file-watcher` channel source: for a channel that defines no `onConnect()`, the framework watches the declared
 * paths with `watchFiles` while the channel is connected, and hands each file event to `onEvent()`. The declared
 * `paths` and `events` were only a label before, so every channel written until now watches in its own
 * `onConnect()`: such a channel is left to watch by itself.
 */
import 'reflect-metadata';

import { getRuntimeContext, watchFiles, type FileWatchEvent, type WatchFilesOptions } from '@frontmcp/utils';

import { type DirectClient } from '../../direct/client.types';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  App,
  channel,
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

/** A channel that declares its paths and defines no `onConnect()`: the framework watches for it. */
@Channel({
  name: 'logs',
  source: { type: 'file-watcher', paths: ['/var/log/app.log', './inbox'], events: ['change', 'create'] },
})
class LogsChannel extends ChannelContext {
  /** Records the payload and names what happened. */
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    handled.push(payload);
    const { event, path } = payload as ChannelFileEvent;
    return { content: `${event} ${path}` };
  }
}

/** A channel written before 1.12: it declares its paths, a glob among them, and watches in its own `onConnect()`. */
@Channel({ name: 'legacy-logs', source: { type: 'file-watcher', paths: ['./logs/*.log'], events: ['change'] } })
class SelfWatchingChannel extends ChannelContext {
  /** Starts a watcher of its own. */
  override async onConnect(): Promise<void> {
    connections.push('connect');
    pushFromOwnWatcher = (payload) => this.pushIncoming(payload);
  }

  /** Stops its own watcher. */
  override async onDisconnect(): Promise<void> {
    connections.push('disconnect');
    pushFromOwnWatcher = undefined;
  }

  /** Records the payload of its own watcher. */
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    handled.push(payload);
    const { file, content } = payload as { file: string; content: string };
    return { content: `[${file}] ${content}` };
  }
}

/** A base class that connects by itself, for channels that extend it. */
abstract class SelfConnectingContext extends ChannelContext {
  /** Connects by itself. */
  override async onConnect(): Promise<void> {
    connections.push('inherited connect');
  }
}

/** A channel that defines no `onConnect()` of its own, and inherits one. */
@Channel({ name: 'inheriting', source: { type: 'file-watcher', paths: ['./drop'] } })
class InheritingChannel extends SelfConnectingContext {
  /** Passes the payload on as text. */
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return { content: String(payload) };
  }
}

const reportsChannel = channel({ name: 'reports', source: { type: 'file-watcher', paths: ['./reports'] } })((
  payload,
) => {
  handled.push(payload);
  return { content: 'report' };
});

/** A file-watcher channel named `name` that defines no `onConnect()` and records what it handles. */
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

/** The config of a server with the given channels, whose log is captured from the info level. */
function configWith(channels: ChannelType[]): FrontMcpConfigInput {
  /** The app that declares the channels. */
  @App({ id: 'files', name: 'Files', channels })
  class FilesApp {}
  return {
    info: { name: 'channel-file-watcher', version: '1.0.0' },
    apps: [FilesApp],
    logging: { level: LogLevel.Info, enableConsole: false, transports: [CaptureLogTransport] },
    channels: { enabled: true },
  };
}

/** A registered channel of a server. */
function channelOf(server: DirectMcpServer, name: string): ChannelInstance {
  const registered = (server as unknown as { scope: ScopeEntry }).scope.channels?.findByName(name);
  if (!registered) throw new Error(`channel ${name} is not registered`);
  return registered;
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

/** What the server logged about a channel that connects itself. */
function loggedAboutOnConnect(): string[] {
  return logged('info').filter((message) => message.includes('defines onConnect()'));
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

  describe('a channel that defines no onConnect()', () => {
    it('is watched once it is connected: the declared paths, for the declared events', async () => {
      server = await FrontMcpInstance.createDirect(configWith([LogsChannel]));

      expect(channelOf(server, 'logs').serviceContext).toBeDefined();
      expect(startedWatches).toHaveLength(1);
      expect(startedWatches[0].paths).toEqual(['/var/log/app.log', './inbox']);
      expect(startedWatches[0].options.events).toEqual(['change', 'add']);
      expect(startedWatches[0].options.signal?.aborted).toBe(false);
      expect(loggedAboutOnConnect()).toEqual([]);
    });

    it.each<[string, ChannelFileWatcherSource['events'], WatchFilesOptions['events']]>([
      ['every event when none is declared', undefined, undefined],
      ['a removal and an arrival for rename', ['rename'], ['add', 'unlink']],
      ['each event once', ['delete', 'rename', 'create'], ['unlink', 'add']],
    ])('is watched for %s', async (_label, declared, watched) => {
      server = await FrontMcpInstance.createDirect(
        configWith([watcherChannel('drops', { paths: ['./drop'], events: declared })]),
      );

      expect(startedWatches).toHaveLength(1);
      expect(startedWatches[0].options.events).toEqual(watched);
    });

    it('gets each file event in onEvent() as { event, path }, and its notification is sent', async () => {
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

    it('gets one file event at a time: the next onEvent() starts once the one before it ended', async () => {
      const steps: string[] = [];
      let endFirstEvent = (): void => undefined;

      /** Takes long over its first file event. */
      @Channel({ name: 'slow-reader', source: { type: 'file-watcher', paths: ['./logs'] } })
      class SlowReaderChannel extends ChannelContext {
        /** Records when it starts and ends, and waits on its first event. */
        async onEvent(payload: unknown): Promise<ChannelNotification> {
          const { event } = payload as ChannelFileEvent;
          steps.push(`${event} started`);
          if (event === 'change') await new Promise<void>((resolve) => (endFirstEvent = resolve));
          steps.push(`${event} ended`);
          return { content: event };
        }
      }
      server = await FrontMcpInstance.createDirect(configWith([SlowReaderChannel]));

      startedWatches[0].report({ type: 'change', path: '/work/logs/app.log' });
      startedWatches[0].report({ type: 'add', path: '/work/logs/app.log' });
      await settle();
      const stepsWhileFirstRuns = [...steps];
      endFirstEvent();
      await settle();

      expect(stepsWhileFirstRuns).toEqual(['change started']);
      expect(steps).toEqual(['change started', 'change ended', 'create started', 'create ended']);
    });

    it('is watched when it is a channel() function, which has no connect handler', async () => {
      server = await FrontMcpInstance.createDirect(configWith([reportsChannel]));

      startedWatches[0].report({ type: 'add', path: '/work/reports/q3.pdf' });
      await settle();

      expect(startedWatches.map((watch) => watch.paths)).toEqual([['./reports']]);
      expect(handled).toEqual([{ event: 'create', path: '/work/reports/q3.pdf' }]);
    });

    it('is no longer watched once it disconnects', async () => {
      server = await FrontMcpInstance.createDirect(configWith([LogsChannel]));
      const { signal } = startedWatches[0].options;

      await channelOf(server, 'logs').disconnectService();

      expect(signal?.aborted).toBe(true);
    });

    it('is no longer watched once the server is disposed', async () => {
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
    ])('is not watched in %s, which the server says, and is still connected', async (_label, runtimeContext) => {
      jest.mocked(getRuntimeContext).mockReturnValue(runtimeContext as never);

      server = await FrontMcpInstance.createDirect(configWith([LogsChannel]));

      expect(watchFiles).not.toHaveBeenCalled();
      expect(channelOf(server, 'logs').serviceContext).toBeDefined();
      expect(logged('warn')).toEqual([
        'Channel "logs" does not watch its paths in a serverless, edge or browser runtime: ' +
          'watching files needs a long-lived process',
      ]);
    });

    it('is not watched when a build boots the server only to read it: such a boot registers no channel', async () => {
      const read = await FrontMcpInstance.createForManifest(configWith([LogsChannel]));
      const [scope] = read.getScopes();
      const registeredChannels = scope.channels;
      await read.shutdown();

      expect(watchFiles).not.toHaveBeenCalled();
      expect(registeredChannels).toBeUndefined();
    });

    it('stays connected when its watch fails, which is logged, and the other channels are still watched', async () => {
      jest.mocked(watchFiles).mockImplementationOnce(failingWatch);

      server = await FrontMcpInstance.createDirect(
        configWith([watcherChannel('broken', { paths: ['./broken'] }), watcherChannel('drops', { paths: ['./drop'] })]),
      );
      await settle();
      startedWatches[0].report({ type: 'add', path: '/work/drop/a.txt' });
      await settle();

      expect(logged('error')).toEqual(['Channel "broken" stopped watching its paths']);
      expect(channelOf(server, 'broken').serviceContext).toBeDefined();
      expect(startedWatches.map((watch) => watch.paths)).toEqual([['./drop']]);
      expect(handled).toEqual([{ channel: 'drops', payload: { event: 'create', path: '/work/drop/a.txt' } }]);
    });

    it('has a path with a wildcard watched as written, with a warning that it is not expanded', async () => {
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

  describe('a channel that defines its own onConnect()', () => {
    it('watches by itself as before: no framework watch, so no file event reaches it twice', async () => {
      server = await FrontMcpInstance.createDirect(configWith([SelfWatchingChannel]));

      pushFromOwnWatcher?.({ file: 'app.log', content: 'ERROR: timeout' });
      await settle();

      expect(watchFiles).not.toHaveBeenCalled();
      expect(connections).toEqual(['connect']);
      expect(handled).toEqual([{ file: 'app.log', content: 'ERROR: timeout' }]);
    });

    it('still has onConnect() and onDisconnect() called', async () => {
      server = await FrontMcpInstance.createDirect(configWith([SelfWatchingChannel]));

      await server.dispose();
      server = undefined;

      expect(connections).toEqual(['connect', 'disconnect']);
      expect(pushFromOwnWatcher).toBeUndefined();
    });

    it('is told once, at info level, that the framework does not watch its paths, and gets no warning', async () => {
      server = await FrontMcpInstance.createDirect(configWith([SelfWatchingChannel]));

      expect(loggedAboutOnConnect()).toEqual([
        'Channel "legacy-logs" defines onConnect(), so it watches by itself: the framework does not watch its ' +
          'declared paths. Remove onConnect() to have the framework watch them.',
      ]);
      expect(logged('warn')).toEqual([]);
    });

    it('is left alone in a serverless deployment too, with no warning', async () => {
      jest.mocked(getRuntimeContext).mockReturnValue({ runtime: 'node', deployment: 'serverless' } as never);

      server = await FrontMcpInstance.createDirect(configWith([SelfWatchingChannel]));

      expect(connections).toEqual(['connect']);
      expect(logged('warn')).toEqual([]);
    });

    it('counts an onConnect() the channel inherits from a class it extends', async () => {
      server = await FrontMcpInstance.createDirect(configWith([InheritingChannel]));

      expect(watchFiles).not.toHaveBeenCalled();
      expect(connections).toEqual(['inherited connect']);
    });

    it('does not keep the other channels from being watched', async () => {
      server = await FrontMcpInstance.createDirect(configWith([SelfWatchingChannel, LogsChannel]));

      expect(startedWatches.map((watch) => watch.paths)).toEqual([['/var/log/app.log', './inbox']]);
    });
  });
});
