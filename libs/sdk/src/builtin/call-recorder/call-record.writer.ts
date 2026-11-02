import { appendFile, chmod, dirname, ensureDir, fileExists, stat } from '@frontmcp/utils';

import type { FrontMcpLogger, OnShutdown } from '../../common';

const encoder = new TextEncoder();

/** Appends call records to the recording in order, off the call's path: a call never waits for the file. */
export class CallRecordWriter implements OnShutdown {
  private pending: Promise<void> = Promise.resolve();
  private pendingBytes = 0;
  private full = false;
  private failureLogged = false;
  private backlogLogged = false;
  private ownerOnly = false;

  constructor(
    private readonly options: { path: string; maxBytes: number },
    private readonly logger: FrontMcpLogger,
  ) {}

  /** Queues one JSONL line; while more than `maxBytes` wait to be written, lines are dropped. */
  write(line: string): void {
    if (this.full) return;
    const bytes = encoder.encode(line).byteLength;
    if (this.pendingBytes > 0 && this.pendingBytes + bytes > this.options.maxBytes) {
      this.reportBacklog();
      return;
    }
    this.pendingBytes += bytes;
    this.pending = this.pending
      .then(() => this.append(line, bytes))
      .catch((error: unknown) => this.reportFailure(error))
      .finally(() => {
        this.pendingBytes -= bytes;
      });
  }

  /** Logs the first failure to record a call; the later ones are dropped silently. */
  reportFailure(error: unknown): void {
    if (this.failureLogged) return;
    this.failureLogged = true;
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Could not record a call to ${this.options.path}; later failures are not logged: ${reason}`);
  }

  async onShutdown(): Promise<void> {
    await this.pending;
  }

  private reportBacklog(): void {
    if (this.backlogLogged) return;
    this.backlogLogged = true;
    this.logger.warn(
      `Dropped a call: ${this.pendingBytes} bytes of calls are still waiting to be written to ${this.options.path}; ` +
        'later drops are not logged',
    );
  }

  private async append(line: string, bytes: number): Promise<void> {
    if (this.full) return;
    const { path, maxBytes } = this.options;
    if ((await this.sizeOnDisk(path)) + bytes > maxBytes) {
      this.full = true;
      this.logger.warn(`Stopped recording calls: ${path} reached its maxBytes of ${maxBytes} bytes`);
      return;
    }
    await appendFile(path, line, { mode: 0o600 });
  }

  /** The file's size, other writers' lines included; an existing file is made owner-only, a missing one's dir made. */
  private async sizeOnDisk(path: string): Promise<number> {
    if (await fileExists(path)) {
      if (!this.ownerOnly) await chmod(path, 0o600);
      this.ownerOnly = true;
      return (await stat(path)).size;
    }
    await ensureDir(dirname(path));
    return 0;
  }
}
