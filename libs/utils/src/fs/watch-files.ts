import { assertNode } from '../crypto/runtime';
import { dirname, pathJoin, pathResolve } from '../path';
import { readdir, stat, watchFile, type FileWatcherHandle } from './fs';

/** What happened to a watched file: it appeared, its content changed, or it is gone. */
export type FileWatchEventType = 'add' | 'change' | 'unlink';

export interface FileWatchEvent {
  type: FileWatchEventType;
  /** The absolute path of the file. */
  path: string;
}

export interface WatchFilesOptions {
  /** The kinds of event to yield. @default every kind */
  events?: FileWatchEventType[];
  /** How long a watched path must stay quiet before its changes are yielded, in milliseconds. @default 100 */
  debounceMs?: number;
  /** Ends the iteration and closes the watchers when it aborts. */
  signal?: AbortSignal;
}

/** How often a path that cannot be read, or watched for want of a directory to watch, is looked at again. */
export const WATCH_FILES_RETRY_MS = 500;

const DEFAULT_DEBOUNCE_MS = 100;

/** One look at a watched path. */
interface Sighting {
  /** The files it holds, each with the fingerprint of its state. */
  files: Map<string, string>;
  /** The directory whose changes tell when to look again; none while neither the path nor its parent exists. */
  directory?: string;
}

type FileStats = Awaited<ReturnType<typeof stat>>;

/** What tells one state of a file from the next: a replaced file, another size, or a later modification. */
function fingerprintOf(stats: FileStats): string {
  return `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
}

/** Whether an error says the path is not there, rather than that it could not be read. */
function isAbsence(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
}

/** The stats of a path, or nothing when it does not exist; any other failure is thrown. */
async function statsOf(path: string): Promise<FileStats | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if (isAbsence(error)) return undefined;
    throw error;
  }
}

/** The entries of a directory, or none when it went away; any other failure is thrown. */
async function entriesOf(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (isAbsence(error)) return [];
    throw error;
  }
}

/** The fingerprint of a directory entry that is a file; the `known` one while the entry cannot be read. */
async function entryFingerprintOf(entry: string, known: string | undefined): Promise<string | undefined> {
  try {
    const stats = await statsOf(entry);
    return stats?.isFile() ? fingerprintOf(stats) : undefined;
  } catch {
    return known;
  }
}

/** Look at a path: a directory holds its direct files, a file holds itself, a missing path holds nothing. */
async function lookAt(target: string, before?: Map<string, string>): Promise<Sighting> {
  const files = new Map<string, string>();
  const stats = await statsOf(target);
  if (stats?.isDirectory()) {
    for (const name of await entriesOf(target)) {
      const child = pathJoin(target, name);
      const fingerprint = await entryFingerprintOf(child, before?.get(child));
      if (fingerprint !== undefined) files.set(child, fingerprint);
    }
    return { files, directory: target };
  }
  if (stats?.isFile()) files.set(target, fingerprintOf(stats));
  const parent = dirname(target);
  const parentStats = await statsOf(parent);
  return { files, directory: parentStats?.isDirectory() ? parent : undefined };
}

/** What changed between two looks at a path. */
function changesBetween(before: Map<string, string>, after: Map<string, string>): FileWatchEvent[] {
  const changes: FileWatchEvent[] = [];
  for (const [path, fingerprint] of after) {
    const known = before.get(path);
    if (known === undefined) changes.push({ type: 'add', path });
    else if (known !== fingerprint) changes.push({ type: 'change', path });
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changes.push({ type: 'unlink', path });
  }
  return changes;
}

/** One watched path: it looks again when its directory changes, and reports what differs from the look before. */
class WatchedPath {
  private files?: Map<string, string>;
  private watched?: { directory: string; handle: FileWatcherHandle };
  private timer?: ReturnType<typeof setTimeout>;
  private looking: Promise<void> = Promise.resolve();
  private closed = false;

  /** Takes the path to watch, how long to wait for changes to settle, and where to report each one. */
  constructor(
    private readonly target: string,
    private readonly debounceMs: number,
    private readonly report: (event: FileWatchEvent) => void,
  ) {}

  /** Take the first look, which reports nothing, and start watching. */
  start(): Promise<void> {
    return this.lookAgain();
  }

  /** Stop watching and looking. */
  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.watched?.handle.close();
  }

  /** Look again once `delayMs` passed without another reason to. */
  private lookLater(delayMs: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.looking = this.looking.then(() => this.lookAgain());
    }, delayMs);
    this.timer.unref?.();
  }

  /** Report what changed since the last look, if any; a path that cannot be read keeps its last look until it can. */
  private async lookAgain(): Promise<void> {
    const sighting = await lookAt(this.target, this.files).catch(() => undefined);
    if (this.closed) return;
    if (!sighting) {
      this.lookLater(WATCH_FILES_RETRY_MS);
      return;
    }
    if (this.files) for (const change of changesBetween(this.files, sighting.files)) this.report(change);
    this.files = sighting.files;
    this.follow(sighting.directory);
  }

  /** Watch the directory that shows the path's changes; while there is none, look again after a wait. */
  private follow(directory: string | undefined): void {
    if (this.watched?.directory !== directory) {
      this.watched?.handle.close();
      this.watched = directory === undefined ? undefined : this.watch(directory);
    }
    if (!this.watched) this.lookLater(WATCH_FILES_RETRY_MS);
  }

  /** Open a watcher on a directory, dropped for a new one when it fails; nothing when the directory went away. */
  private watch(directory: string): { directory: string; handle: FileWatcherHandle } | undefined {
    try {
      const handle = watchFile(directory, () => this.lookLater(this.debounceMs));
      const watched = { directory, handle };
      handle.onError(() => {
        if (this.watched !== watched) return;
        handle.close();
        this.watched = undefined;
        this.lookLater(this.debounceMs);
      });
      return watched;
    } catch {
      return undefined;
    }
  }
}

/**
 * Watch files and directories, and yield what happens to their files, until `signal` aborts or the loop is left. A
 * directory is watched for its direct files; a path that does not exist yet, from the moment it appears. Node.js only.
 */
export async function* watchFiles(
  paths: string | string[],
  options: WatchFilesOptions = {},
): AsyncGenerator<FileWatchEvent, void, undefined> {
  assertNode('watchFiles');
  const { events, debounceMs = DEFAULT_DEBOUNCE_MS, signal } = options;
  const pending: FileWatchEvent[] = [];
  let wake: (() => void) | undefined;
  const wakeUp = () => wake?.();
  const report = (event: FileWatchEvent) => {
    if (events && !events.includes(event.type)) return;
    pending.push(event);
    wakeUp();
  };
  const targets = Array.isArray(paths) ? paths : [paths];
  const watchedPaths = targets.map((path) => new WatchedPath(pathResolve(path), debounceMs, report));

  signal?.addEventListener('abort', wakeUp, { once: true });
  try {
    await Promise.all(watchedPaths.map((watchedPath) => watchedPath.start()));
    while (!signal?.aborted) {
      const event = pending.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    signal?.removeEventListener('abort', wakeUp);
    for (const watchedPath of watchedPaths) watchedPath.close();
  }
}
