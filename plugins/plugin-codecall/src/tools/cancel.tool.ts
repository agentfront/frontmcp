import { Tool, ToolContext } from '@frontmcp/sdk';

import { CodeCallRunStoreToken } from '../runs/run-record.types';
import { claimPausedRun, readPausedRun, runNotFoundError } from './paused-runs';
import {
  cancelToolDescription,
  runIdToolInputSchema,
  runStatusOutputSchema,
  type RunIdToolInput,
  type RunStatusOutput,
} from './runs.schema';

/** Cancels one of the caller's paused runs: it claims the pause, so no resume can, and keeps the run `cancelled`. */
@Tool({
  name: 'codecall:cancel',
  cache: { ttl: 0, slideWindow: false },
  codecall: { enabledInCodeCall: false, visibleInListTools: true },
  description: cancelToolDescription,
  inputSchema: runIdToolInputSchema,
  outputSchema: runStatusOutputSchema,
})
export default class CancelTool extends ToolContext {
  async execute({ runId }: RunIdToolInput): Promise<RunStatusOutput> {
    const runs = this.tryGet(CodeCallRunStoreToken);
    if (!runs) throw runNotFoundError(runId);
    const run = await readPausedRun(runs, runId, this);
    await claimPausedRun(runs, run, this, 0);
    const endedAt = new Date().toISOString();
    await runs.keep(this, { ...run, status: 'cancelled', endedAt, pause: undefined });
    return { runId, status: 'cancelled', startedAt: run.startedAt, endedAt, calls: run.journal.length };
  }
}
