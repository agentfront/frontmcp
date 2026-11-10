import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { WATCH_FILES_RETRY_MS, watchFiles, type FileWatchEvent, type WatchFilesOptions } from '../watch-files';

const mockIsNode = jest.fn(() => true);
jest.mock('../../crypto/runtime', () => ({
  ...jest.requireActual('../../crypto/runtime'),
  isNode: () => mockIsNode(),
  assertNode: (feature: string) => {
    if (!mockIsNode()) throw new Error(`${feature} is not supported in the browser. Requires Node.js.`);
  },
}));

const DEBOUNCE_MS = 20;

/** A running watch whose events a test waits for. */
interface Watch {
  events: FileWatchEvent[];
  /** Resolves once `count` events arrived. */
  until(count: number): Promise<FileWatchEvent[]>;
  /** Waits long enough for an event that should not come to have come. */
  quiet(): Promise<FileWatchEvent[]>;
  stop(): Promise<void>;
}

/** Waits until a condition holds. */
async function untilTrue(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Starts a watch and collects what it yields. Resolves once it took its first look and opened `watchers` watchers
 * (one per path, unless a test says a path has no directory to watch yet), and they had a moment to attach.
 */
async function watching(
  paths: string | string[],
  options: WatchFilesOptions = {},
  watchers = Array.isArray(paths) ? paths.length : 1,
): Promise<Watch> {
  const nodeFs = jest.requireActual<typeof import('fs')>('fs');
  const opened = jest.spyOn(nodeFs, 'watch');
  const looked = jest.spyOn(nodeFs.promises, 'stat');
  const controller = new AbortController();
  const events: FileWatchEvent[] = [];
  const iterator = watchFiles(paths, { debounceMs: DEBOUNCE_MS, signal: controller.signal, ...options });
  const done = (async () => {
    for await (const event of iterator) events.push(event);
  })();
  await untilTrue(() => looked.mock.calls.length > 0 && opened.mock.calls.length >= watchers);
  await new Promise((resolve) => setTimeout(resolve, 50));
  return {
    events,
    async until(count) {
      const deadline = Date.now() + 5000;
      while (events.length < count) {
        if (Date.now() > deadline) throw new Error(`${events.length} of ${count} events arrived`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return events;
    },
    async quiet() {
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 150));
      return events;
    },
    async stop() {
      controller.abort();
      await done;
    },
  };
}

/** Counts the watchers `fs.watch` opens and the ones that were closed. */
function countWatchers(): { opened: () => number; closed: () => number } {
  const nodeFs = jest.requireActual<typeof import('fs')>('fs');
  const openWatcher = nodeFs.watch.bind(nodeFs) as (...args: unknown[]) => fs.FSWatcher;
  const closes: jest.SpyInstance[] = [];
  jest.spyOn(nodeFs, 'watch').mockImplementation(((...args: unknown[]) => {
    const watcher = openWatcher(...args);
    closes.push(jest.spyOn(watcher, 'close'));
    return watcher;
  }) as never);
  return {
    opened: () => closes.length,
    closed: () => closes.filter((close) => close.mock.calls.length > 0).length,
  };
}

describe('watchFiles', () => {
  let root: string;
  let watch: Watch | undefined;

  beforeEach(async () => {
    root = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'watch-files-')));
    mockIsNode.mockReturnValue(true);
  });

  afterEach(async () => {
    await watch?.stop();
    watch = undefined;
    jest.restoreAllMocks();
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  describe('a directory', () => {
    it('yields add for a file created in it', async () => {
      watch = await watching(root);

      await fs.promises.writeFile(path.join(root, 'new.txt'), 'hello');

      expect(await watch.until(1)).toEqual([{ type: 'add', path: path.join(root, 'new.txt') }]);
    });

    it('yields change for a file whose content changes', async () => {
      const file = path.join(root, 'notes.txt');
      await fs.promises.writeFile(file, 'one');
      watch = await watching(root);

      await fs.promises.writeFile(file, 'one and two');

      expect(await watch.until(1)).toEqual([{ type: 'change', path: file }]);
    });

    it('yields unlink for a file that is removed', async () => {
      const file = path.join(root, 'old.txt');
      await fs.promises.writeFile(file, 'bye');
      watch = await watching(root);

      await fs.promises.rm(file);

      expect(await watch.until(1)).toEqual([{ type: 'unlink', path: file }]);
    });

    it('does not yield the files that are there when the watch starts', async () => {
      await fs.promises.writeFile(path.join(root, 'already.txt'), 'here');

      watch = await watching(root);

      expect(await watch.quiet()).toEqual([]);
    });

    it('yields one change for several writes within the debounce time', async () => {
      const file = path.join(root, 'draft.txt');
      await fs.promises.writeFile(file, '1');
      watch = await watching(root, { debounceMs: 150 });

      await fs.promises.writeFile(file, '12');
      await fs.promises.writeFile(file, '123');
      await fs.promises.writeFile(file, '1234');

      await watch.until(1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(watch.events).toEqual([{ type: 'change', path: file }]);
    });

    it('leaves out its subdirectories and what they hold', async () => {
      watch = await watching(root);

      await fs.promises.mkdir(path.join(root, 'nested'));
      await fs.promises.writeFile(path.join(root, 'nested', 'deep.txt'), 'deep');
      await fs.promises.writeFile(path.join(root, 'top.txt'), 'top');

      expect(await watch.until(1)).toEqual([{ type: 'add', path: path.join(root, 'top.txt') }]);
      expect(await watch.quiet()).toHaveLength(1);
    });

    it('yields only the kinds of event asked for', async () => {
      const file = path.join(root, 'kept.txt');
      await fs.promises.writeFile(file, 'kept');
      watch = await watching(root, { events: ['add'] });

      await fs.promises.writeFile(file, 'changed');
      await fs.promises.rm(file);
      await fs.promises.writeFile(path.join(root, 'fresh.txt'), 'fresh');

      expect(await watch.until(1)).toEqual([{ type: 'add', path: path.join(root, 'fresh.txt') }]);
      expect(await watch.quiet()).toHaveLength(1);
    });

    it('yields unlink for its files when it is removed, and add again once it is back', async () => {
      const inbox = path.join(root, 'inbox');
      const file = path.join(inbox, 'mail.txt');
      await fs.promises.mkdir(inbox);
      await fs.promises.writeFile(file, 'mail');
      watch = await watching(inbox);

      await fs.promises.rm(inbox, { recursive: true });
      expect(await watch.until(1)).toEqual([{ type: 'unlink', path: file }]);

      await fs.promises.mkdir(inbox);
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 100));
      await fs.promises.writeFile(file, 'more mail');
      expect((await watch.until(2))[1]).toEqual({ type: 'add', path: file });
    });
  });

  describe('a file', () => {
    it('yields its changes, its removal and its return, and nothing for its siblings', async () => {
      const file = path.join(root, 'config.json');
      await fs.promises.writeFile(file, '{}');
      watch = await watching(file);

      await fs.promises.writeFile(path.join(root, 'sibling.txt'), 'ignored');
      await fs.promises.writeFile(file, '{"a":1}');
      await watch.until(1);
      await fs.promises.rm(file);
      await watch.until(2);
      await fs.promises.writeFile(file, '{"b":2}');

      expect(await watch.until(3)).toEqual([
        { type: 'change', path: file },
        { type: 'unlink', path: file },
        { type: 'add', path: file },
      ]);
    });
  });

  describe('a path that does not exist yet', () => {
    it('is watched from the moment it appears as a file', async () => {
      const file = path.join(root, 'later.txt');
      watch = await watching(file);

      await fs.promises.writeFile(file, 'now');

      expect(await watch.until(1)).toEqual([{ type: 'add', path: file }]);
    });

    it('is watched for its files from the moment it appears as a directory', async () => {
      const inbox = path.join(root, 'inbox');
      watch = await watching(inbox);

      await fs.promises.mkdir(inbox);
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 100));
      await fs.promises.writeFile(path.join(inbox, 'first.txt'), 'first');

      expect(await watch.until(1)).toEqual([{ type: 'add', path: path.join(inbox, 'first.txt') }]);
    });

    it('is looked for again while its parent directory is missing too', async () => {
      const file = path.join(root, 'missing', 'deeper', 'file.txt');
      watch = await watching(file, {}, 0);

      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, 'found');

      const [event] = await watch.until(1);
      expect(event).toEqual({ type: 'add', path: file });
      expect(WATCH_FILES_RETRY_MS).toBe(500);
    });
  });

  it('watches several paths, relative ones from the working directory', async () => {
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    await fs.promises.mkdir(first);
    await fs.promises.mkdir(second);
    watch = await watching([path.relative(process.cwd(), first), second]);

    await fs.promises.writeFile(path.join(first, 'a.txt'), 'a');
    await watch.until(1);
    await fs.promises.writeFile(path.join(second, 'b.txt'), 'b');

    expect(await watch.until(2)).toEqual([
      { type: 'add', path: path.join(first, 'a.txt') },
      { type: 'add', path: path.join(second, 'b.txt') },
    ]);
  });

  describe('ending', () => {
    it('ends the iteration when the signal aborts, and closes its watchers', async () => {
      const watchers = countWatchers();
      const controller = new AbortController();
      const iterator = watchFiles(root, { signal: controller.signal });
      const next = iterator.next();
      await new Promise((resolve) => setTimeout(resolve, 50));

      controller.abort();

      expect(await next).toEqual({ done: true, value: undefined });
      expect(watchers.opened()).toBe(1);
      expect(watchers.closed()).toBe(1);
    });

    it('yields nothing with a signal that is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const yielded: FileWatchEvent[] = [];
      for await (const event of watchFiles(root, { signal: controller.signal })) yielded.push(event);

      expect(yielded).toEqual([]);
    });

    it('closes its watchers when the loop is left', async () => {
      const watchers = countWatchers();
      const writing = setTimeout(() => void fs.promises.writeFile(path.join(root, 'one.txt'), '1'), 60);

      for await (const event of watchFiles(root, { debounceMs: DEBOUNCE_MS })) {
        expect(event.type).toBe('add');
        break;
      }

      clearTimeout(writing);
      expect(watchers.opened()).toBe(1);
      expect(watchers.closed()).toBe(1);
    });

    it('stops looking for a missing path once the signal aborts', async () => {
      const looked = jest.spyOn(fs.promises, 'stat');
      watch = await watching(path.join(root, 'never', 'there.txt'), {}, 0);
      await watch.stop();
      watch = undefined;
      const looksAtStop = looked.mock.calls.length;

      await new Promise((resolve) => setTimeout(resolve, WATCH_FILES_RETRY_MS + 100));

      expect(looked.mock.calls.length).toBe(looksAtStop);
    });
  });

  describe('a directory that goes away at the wrong moment', () => {
    it('is looked for again when it cannot be watched, and watched once it can', async () => {
      const nodeFs = jest.requireActual<typeof import('fs')>('fs');
      const openWatcher = nodeFs.watch.bind(nodeFs) as (...args: unknown[]) => fs.FSWatcher;
      let refusals = 1;
      jest.spyOn(nodeFs, 'watch').mockImplementation(((...args: unknown[]) => {
        if (refusals-- > 0) throw new Error('ENOENT: no such file or directory');
        return openWatcher(...args);
      }) as never);
      watch = await watching(root);

      await new Promise((resolve) => setTimeout(resolve, WATCH_FILES_RETRY_MS + 100));
      await fs.promises.writeFile(path.join(root, 'late.txt'), 'late');

      expect(await watch.until(1)).toEqual([{ type: 'add', path: path.join(root, 'late.txt') }]);
    });

    it('holds no files when it cannot be listed', async () => {
      const file = path.join(root, 'listed.txt');
      await fs.promises.writeFile(file, 'listed');
      watch = await watching(root);
      jest.spyOn(fs.promises, 'readdir').mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

      await fs.promises.writeFile(path.join(root, 'trigger.txt'), 'trigger');

      expect(await watch.until(1)).toEqual([{ type: 'unlink', path: file }]);
    });

    it('looks again when its watcher reports an error', async () => {
      const nodeFs = jest.requireActual<typeof import('fs')>('fs');
      const openWatcher = nodeFs.watch.bind(nodeFs) as (...args: unknown[]) => fs.FSWatcher;
      const watchers: fs.FSWatcher[] = [];
      jest.spyOn(nodeFs, 'watch').mockImplementation(((...args: unknown[]) => {
        watchers.push(openWatcher(...args));
        return watchers[watchers.length - 1];
      }) as never);
      watch = await watching(root);
      const looked = jest.spyOn(fs.promises, 'stat');
      const looksBefore = looked.mock.calls.length;

      watchers[0].emit('error', new Error('EMFILE: too many open files'));
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 100));

      expect(looked.mock.calls.length).toBeGreaterThan(looksBefore);
      expect(watch.events).toEqual([]);
    });
  });

  it('rejects outside Node.js', async () => {
    mockIsNode.mockReturnValue(false);

    await expect(watchFiles(root).next()).rejects.toThrow('watchFiles is not supported in the browser');
  });
});
