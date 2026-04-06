// file: libs/sdk/src/channel/sources/agent-completion.source.ts

import type { FrontMcpLogger } from '../../common';
import type { ChannelInstance } from '../channel.instance';
import type { ChannelAgentCompletionSource } from '../../common/metadata/channel.metadata';

/**
 * Event payload from agent completion.
 * This is the shape the source expects from the agent emitter.
 */
export interface AgentCompletionEvent {
  agentId: string;
  agentName: string;
  status: 'success' | 'error';
  durationMs?: number;
  output?: string;
  error?: string;
  runId?: string;
  /** Session that triggered this agent execution (for session-scoped delivery) */
  sessionId?: string;
}

/**
 * Wires an agent-completion channel source to an agent registry emitter.
 *
 * @param channel - The channel instance to push notifications to
 * @param sourceConfig - The agent-completion source configuration
 * @param agentEmitterSubscribe - Subscribe function from the agent registry
 * @param logger - Logger instance
 * @returns Unsubscribe function
 */
export function wireAgentCompletionSource(
  channel: ChannelInstance,
  sourceConfig: ChannelAgentCompletionSource,
  agentEmitterSubscribe: (cb: (event: AgentCompletionEvent) => void) => () => void,
  logger: FrontMcpLogger,
): () => void {
  const filterAgentIds = sourceConfig.agentIds;

  return agentEmitterSubscribe((event) => {
    // Apply agent ID filter if specified
    if (filterAgentIds && filterAgentIds.length > 0) {
      if (!filterAgentIds.includes(event.agentId) && !filterAgentIds.includes(event.agentName)) {
        return;
      }
    }

    logger.verbose(
      `Agent completion event for channel "${channel.name}": agent=${event.agentId}, status=${event.status}`,
    );

    // Push the event through the channel's onEvent handler
    // If sessionId is present, deliver only to that session (prevents data leak)
    channel.handleEvent(event, event.sessionId).catch((err) => {
      logger.error(`Failed to handle agent completion event in channel "${channel.name}"`, { error: err });
    });
  });
}
