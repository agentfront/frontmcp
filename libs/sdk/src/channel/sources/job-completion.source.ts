// file: libs/sdk/src/channel/sources/job-completion.source.ts

import type { FrontMcpLogger } from '../../common';
import type { ChannelInstance } from '../channel.instance';
import type { ChannelJobCompletionSource } from '../../common/metadata/channel.metadata';

/**
 * Event payload from job completion.
 */
export interface JobCompletionEvent {
  jobName: string;
  jobId: string;
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  durationMs?: number;
  output?: string;
  error?: string;
  attempt?: number;
  /** Session that triggered this job execution (for session-scoped delivery) */
  sessionId?: string;
}

/**
 * Wires a job-completion channel source to a job execution manager emitter.
 *
 * @param channel - The channel instance to push notifications to
 * @param sourceConfig - The job-completion source configuration
 * @param jobEmitterSubscribe - Subscribe function from the job execution manager
 * @param logger - Logger instance
 * @returns Unsubscribe function
 */
export function wireJobCompletionSource(
  channel: ChannelInstance,
  sourceConfig: ChannelJobCompletionSource,
  jobEmitterSubscribe: (cb: (event: JobCompletionEvent) => void) => () => void,
  logger: FrontMcpLogger,
): () => void {
  const filterJobNames = sourceConfig.jobNames;

  return jobEmitterSubscribe((event) => {
    // Apply job name filter if specified
    if (filterJobNames && filterJobNames.length > 0) {
      if (!filterJobNames.includes(event.jobName) && !filterJobNames.includes(event.jobId)) {
        return;
      }
    }

    logger.verbose(`Job completion event for channel "${channel.name}": job=${event.jobName}, status=${event.status}`);

    // If sessionId is present, deliver only to that session (prevents data leak)
    channel.handleEvent(event, event.sessionId).catch((err) => {
      logger.error(`Failed to handle job completion event in channel "${channel.name}"`, { error: err });
    });
  });
}
