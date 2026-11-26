import { Tool, ToolContext } from '@frontmcp/sdk';

import { pausedAnswerOf } from '../runs/run-pause';
import { CodeCallRunStoreToken } from '../runs/run-record.types';
import { runNotFoundError } from './paused-runs';
import {
  runIdToolInputSchema,
  runStatusOutputSchema,
  statusToolDescription,
  type RunIdToolInput,
  type RunStatusOutput,
} from './runs.schema';

/** The status of one of the caller's runs; a paused run past its wait is not found. */
@Tool({
  name: 'codecall:status',
  cache: { ttl: 0, slideWindow: false },
  codecall: { enabledInCodeCall: false, visibleInListTools: true },
  description: statusToolDescription,
  inputSchema: runIdToolInputSchema,
  outputSchema: runStatusOutputSchema,
})
export default class StatusTool extends ToolContext {
  async execute({ runId }: RunIdToolInput): Promise<RunStatusOutput> {
    const runs = this.tryGet(CodeCallRunStoreToken);
    const record = await runs?.read(runId, this);
    const pause = record?.status === 'paused' ? record.pause : undefined;
    if (!runs || !record || (record.status === 'paused' && !(pause && Date.parse(pause.expiresAt) > Date.now()))) {
      throw runNotFoundError(runId);
    }
    return {
      runId,
      status: record.status,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      calls: record.journal.length + (record.omittedEntries ?? 0),
      ...(pause && { paused: pausedAnswerOf(pause) }),
    };
  }
}
