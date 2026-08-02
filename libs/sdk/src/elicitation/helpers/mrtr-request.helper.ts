/**
 * Server→client input requests that travel via MRTR — protocol 2026-07-28.
 *
 * Sampling (`sampling/createMessage`) and roots (`roots/list`) have no inline
 * transport in this revision: the server→client request direction was removed,
 * so the only way to ask is to answer the caller's request with an
 * `InputRequiredResult` and let them retry.
 *
 * Both are DEPRECATED by SEP-2577 and remain in the specification for at least
 * twelve months. They are offered here so servers that need them during the
 * deprecation window have a conforming path; new servers should prefer tool
 * parameters (instead of roots) and a direct LLM provider integration (instead
 * of sampling).
 *
 * @module elicitation/helpers/mrtr-request.helper
 */

import { type FrontMcpContext } from '../../context';
import { SamplingNotAvailableError } from '../../errors';

/** A message in a sampling conversation. */
export interface SamplingMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } | Record<string, unknown>;
}

/** Options accepted by `this.sample(...)`. */
export interface SampleOptions {
  /** Conversation to complete. */
  messages: SamplingMessage[];
  /** Maximum tokens to generate. Required by the MCP schema. */
  maxTokens: number;
  systemPrompt?: string;
  modelPreferences?: {
    hints?: Array<{ name?: string }>;
    costPriority?: number;
    speedPriority?: number;
    intelligencePriority?: number;
  };
  temperature?: number;
  stopSequences?: string[];
  /**
   * Context inclusion. `"thisServer"` / `"allServers"` are deprecated in
   * 2026-07-28 and are only forwarded when the client declared
   * `sampling.context` support; omit the field or use `"none"`.
   */
  includeContext?: 'none' | 'thisServer' | 'allServers';
  metadata?: Record<string, unknown>;
}

/** The model's reply to a sampling request. */
export interface SampleResult {
  role: string;
  content: unknown;
  model?: string;
  stopReason?: string;
}

/** A filesystem root the client exposed. */
export interface Root {
  uri: string;
  name?: string;
}

/**
 * Ask the client's LLM to complete a conversation.
 *
 * Only available under protocol 2026-07-28 (via MRTR). Earlier revisions used a
 * server-initiated `sampling/createMessage` request, which FrontMCP has never
 * implemented, so calling this on an older connection fails explicitly rather
 * than hanging.
 */
export function performSample(ctx: FrontMcpContext | undefined, options: SampleOptions): SampleResult {
  const mrtr = ctx?.getMrtrExchange?.();
  if (!mrtr) throw new SamplingNotAvailableError();

  return mrtr.resolveSampling({
    messages: options.messages,
    maxTokens: options.maxTokens,
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
    ...(options.modelPreferences === undefined ? {} : { modelPreferences: options.modelPreferences }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.stopSequences === undefined ? {} : { stopSequences: options.stopSequences }),
    ...(options.includeContext === undefined ? {} : { includeContext: options.includeContext }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  });
}

/**
 * Ask the client which filesystem roots it exposes.
 *
 * Only available under protocol 2026-07-28 (via MRTR), for the same reason as
 * {@link performSample}.
 */
export function performListRoots(ctx: FrontMcpContext | undefined): Root[] {
  const mrtr = ctx?.getMrtrExchange?.();
  if (!mrtr) throw new SamplingNotAvailableError('roots/list');

  return mrtr.resolveRoots().roots;
}
