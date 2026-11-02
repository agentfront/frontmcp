import { getRuntimeContext } from '@frontmcp/utils';

import type { FrontMcpLogger } from '../common/interfaces/logger.interface';
import type { OnShutdown } from '../common/interfaces/provider.interface';
import type { OffloadOptions } from '../common/types/options/offload';
import { OffloadAbortedError, OffloadUnsupportedRuntimeError } from '../errors/offload.errors';
import type { OffloadPool } from './offload-pool';
import type { OffloadRun, OffloadTask } from './offload.types';

/** The scope's offload pool, loaded on the first call (Node only) and closed by the scope's `onShutdown()`. */
export class OffloadService implements OnShutdown {
  private pool?: Promise<OffloadPool>;
  private closed = false;

  constructor(
    private readonly options: OffloadOptions | undefined,
    private readonly logger: FrontMcpLogger,
  ) {}

  async run(task: OffloadTask, call: OffloadRun): Promise<unknown> {
    const { runtime } = getRuntimeContext();
    if (runtime !== 'node') throw new OffloadUnsupportedRuntimeError(runtime);
    if (this.closed) throw new OffloadAbortedError(call.label, 'shutdown');
    this.pool ??= import('./offload-pool.js').then(({ OffloadPool }) => new OffloadPool(this.options, this.logger));
    return (await this.pool).run(task, call);
  }

  async onShutdown(): Promise<void> {
    this.closed = true;
    const pool = this.pool;
    this.pool = undefined;
    if (pool) await (await pool).close();
  }
}
