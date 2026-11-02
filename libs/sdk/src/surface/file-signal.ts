import { basename, dirname, readFile, watchFile, type FileWatcherHandle } from '@frontmcp/utils';

import type { EnabledSource } from '../common/metadata/enabled.metadata';
import { InvalidFileSignalError, type ErrorRemedy } from '../errors/mcp.error';

export interface FileSignalOptions {
  /** The answer while the file is missing, is not JSON, or has no boolean under the key. Defaults to `false`. */
  defaultValue?: boolean;
  /** How often the file is read again, on top of watching it (and instead of it where watching fails). Defaults to 2000. */
  pollIntervalMs?: number;
  /** How the caller turns the entry back on, sent with the `FEATURE_OFF` refusal. */
  remedy?: ErrorRemedy;
  /** Where a file it cannot use is reported, once per problem. Defaults to `console`. */
  logger?: { warn(message: string): void };
}

class FileSignal implements EnabledSource {
  readonly remedy: ErrorRemedy;
  private readonly defaultValue: boolean;
  private readonly pollIntervalMs: number;
  private readonly logger: { warn(message: string): void };
  private readonly listeners = new Set<() => void>();
  /** The last value read while listeners follow the file. */
  private value?: boolean;
  private problem?: string;
  private watcher?: FileWatcherHandle;
  private poller?: ReturnType<typeof setInterval>;
  private checking: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly key: string,
    options: FileSignalOptions,
  ) {
    this.defaultValue = options.defaultValue ?? false;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.remedy = options.remedy ?? { say: `Turn on the "${key}" feature, then try again.` };
    this.logger = options.logger ?? console;
  }

  async get(): Promise<boolean> {
    return this.value ?? this.read();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      if (this.listeners.delete(listener) && this.listeners.size === 0) this.stop();
    };
  }

  private start(): void {
    this.check();
    try {
      const fileName = basename(this.path);
      this.watcher = watchFile(dirname(this.path), (_event, changed) => {
        if (!changed || changed === fileName) this.check();
      });
      this.watcher.onError(() => this.closeWatcher());
    } catch {
      this.watcher = undefined;
    }
    this.poller = setInterval(() => this.check(), this.pollIntervalMs);
    this.poller.unref?.();
  }

  private stop(): void {
    this.closeWatcher();
    clearInterval(this.poller);
    this.poller = undefined;
    this.value = undefined;
  }

  private closeWatcher(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  private check(): void {
    this.checking = this.checking.then(async () => {
      const next = await this.read();
      if (this.listeners.size === 0) return;
      const previous = this.value;
      this.value = next;
      if (previous === undefined || previous === next) return;
      for (const listener of [...this.listeners]) this.notify(listener);
    });
  }

  private notify(listener: () => void): void {
    try {
      listener();
    } catch (error) {
      this.logger.warn(
        `fileSignal: a listener of "${this.key}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async read(): Promise<boolean> {
    let content: string;
    try {
      content = await readFile(this.path);
    } catch {
      return this.fallBack(`${this.path} could not be read`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return this.fallBack(`${this.path} is not valid JSON`);
    }
    const value = (parsed as Record<string, unknown> | null)?.[this.key];
    if (typeof value !== 'boolean') return this.fallBack(`${this.path} has no boolean "${this.key}"`);
    this.problem = undefined;
    return value;
  }

  private fallBack(problem: string): boolean {
    if (this.problem !== problem) {
      this.problem = problem;
      this.logger.warn(`fileSignal: ${problem}; "${this.key}" is ${this.defaultValue ? 'on' : 'off'}, its default.`);
    }
    return this.defaultValue;
  }
}

/**
 * An `EnabledSource` that reads the boolean under `key` in the JSON file at `path`, and follows the file as it
 * changes: it watches the file's directory and reads the file again every `pollIntervalMs`. A missing or
 * unparsable file means the default (`false`), reported once.
 *
 * @example
 * ```ts
 * @Tool({ name: 'review_list', enabled: fileSignal('./features.json', 'reviews') })
 * ```
 */
export function fileSignal(path: string, key: string, options: FileSignalOptions = {}): EnabledSource {
  if (!path) throw new InvalidFileSignalError('it needs a file path');
  if (!key) throw new InvalidFileSignalError('it needs a key');
  const { pollIntervalMs } = options;
  if (pollIntervalMs !== undefined && !(Number.isFinite(pollIntervalMs) && pollIntervalMs > 0)) {
    throw new InvalidFileSignalError(`pollIntervalMs must be a positive number, got ${pollIntervalMs}`);
  }
  return new FileSignal(path, key, options);
}
