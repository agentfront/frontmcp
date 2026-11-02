import { appendFile, dirname, ensureDir, fileExists, stat } from '@frontmcp/utils';

import type { FrontMcpLogger, OnShutdown } from '../../common';
import type { CallRecord } from './call-record';

const encoder = new TextEncoder();

/** Appends call records to the recording in order, off the call's path: a call never waits for the file. */
export class CallRecordWriter implements OnShutdown {
  private pending: Promise<void> = Promise.resolve();
  private bytes: number | undefined;
  private full = false;
  private failureLogged = false;

  constructor(
    private readonly options: { path: string; maxBytes: number },
    private readonly logger: FrontMcpLogger,
  ) {}

  write(record: CallRecord): void {
    if (this.full) return;
    const line = `${JSON.stringify(record)}\n`;
    this.pending = this.pending.then(() => this.append(line)).catch((error: unknown) => this.reportFailure(error));
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

  private async append(line: string): Promise<void> {
    if (this.full) return;
    const { path, maxBytes } = this.options;
    if (this.bytes === undefined) {
      await ensureDir(dirname(path));
      this.bytes = (await fileExists(path)) ? (await stat(path)).size : 0;
    }
    const lineBytes = encoder.encode(line).byteLength;
    if (this.bytes + lineBytes > maxBytes) {
      this.full = true;
      this.logger.warn(`Stopped recording calls: ${path} reached its maxBytes of ${maxBytes} bytes`);
      return;
    }
    await appendFile(path, line);
    this.bytes += lineBytes;
  }
}
