/**
 * Multi Round-Trip Requests (MRTR) — protocol 2026-07-28, SEP-2322.
 *
 * ## How a round trip works
 *
 * 1. The tool calls `this.elicit(...)`. No response is recorded for that call
 *    yet, so the exchange records the pending request and throws
 *    {@link InputRequiredSignal}.
 * 2. The dispatcher turns the signal into an `InputRequiredResult`
 *    (`resultType: "input_required"`) carrying `inputRequests` and an opaque
 *    `requestState`.
 * 3. The client gathers the input and re-issues the SAME request with
 *    `inputResponses` + `requestState`.
 * 4. The tool runs again from the top. This time `elicit()` finds a recorded
 *    answer for its call and returns it inline, so execution proceeds.
 *
 * Tools are therefore replayed, not resumed — which is why the keys are derived
 * from the call ORDER (`elicit-1`, `elicit-2`, …) rather than randomly: the
 * second run must line its calls up with the first run's answers.
 *
 * `requestState` accumulates every answer gathered so far, so a multi-step tool
 * converges even if the client only echoes the most recent `inputResponses`.
 */
import type { InputRequests, InputResponses } from '@frontmcp/protocol';

import { type ElicitStatus } from '../../elicitation';
import { InputRequiredSignal, MissingClientCapabilityError } from '../../errors';

/** Shape recorded for a pending elicitation before it becomes an input request. */
export interface PendingElicitation {
  message: string;
  requestedSchema: Record<string, unknown>;
  mode?: 'form' | 'url';
  url?: string;
}

/**
 * Translate the wire-format elicitation answer to the SDK's internal shape.
 *
 * The MCP schema names the field `action`; FrontMCP's `ElicitResult` names it
 * `status`. Both spellings are accepted so a client that mirrors either one is
 * understood.
 */
function toElicitResult(response: Record<string, unknown>): { status: ElicitStatus; content?: unknown } {
  const action = (response['action'] ?? response['status']) as ElicitStatus | undefined;
  return {
    status: action ?? 'cancel',
    ...(response['content'] === undefined ? {} : { content: response['content'] }),
  };
}

interface DecodedRequestState {
  responses: InputResponses;
}

/** Encode accumulated answers into the opaque blob the client echoes back. */
export function encodeRequestState(responses: InputResponses): string {
  return Buffer.from(JSON.stringify({ responses } satisfies DecodedRequestState), 'utf8').toString('base64url');
}

/**
 * Decode a client-echoed `requestState`.
 *
 * A malformed blob is treated as "no prior answers" rather than an error: the
 * value is opaque to the client, so the only way it can be wrong is if it was
 * tampered with or truncated, and restarting the exchange is safer than failing
 * the call.
 */
export function decodeRequestState(state: unknown): InputResponses {
  if (typeof state !== 'string' || state.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as DecodedRequestState;
    return parsed && typeof parsed.responses === 'object' && parsed.responses !== null ? parsed.responses : {};
  } catch {
    return {};
  }
}

/**
 * Per-request bookkeeping for one MRTR exchange.
 *
 * Lives on the `FrontMcpContext` for the duration of a single dispatch, so
 * `elicit()` deep inside a tool can reach it without threading it through
 * every flow stage.
 */
export class MrtrExchange {
  /** Answers already supplied by the client, keyed by input-request key. */
  private readonly responses: InputResponses;

  /** Requests raised during THIS run that the client still has to answer. */
  private readonly pending: InputRequests = {};

  /** Number of `elicit()` calls seen so far, used to derive stable keys. */
  private elicitCount = 0;

  constructor(params: {
    /** `inputResponses` from the request params. */
    inputResponses?: InputResponses;
    /** Answers carried over from earlier rounds via `requestState`. */
    carriedResponses?: InputResponses;
    /** Capabilities the client declared for this request. */
    clientCapabilities: Record<string, unknown>;
  }) {
    // Fresh `inputResponses` win over carried ones for the same key: the client
    // is answering the question we just asked.
    this.responses = { ...(params.carriedResponses ?? {}), ...(params.inputResponses ?? {}) };
    this.clientCapabilities = params.clientCapabilities;
  }

  readonly clientCapabilities: Record<string, unknown>;

  /** True when the client declared support for elicitation in this request. */
  supportsElicitation(): boolean {
    return (
      typeof this.clientCapabilities['elicitation'] === 'object' && this.clientCapabilities['elicitation'] !== null
    );
  }

  /**
   * Resolve the next `elicit()` call.
   *
   * Returns the recorded answer when the client already supplied one, otherwise
   * records the request and throws so the dispatcher can ask for it.
   */
  resolveElicitation(pending: PendingElicitation): { status: ElicitStatus; content?: unknown } {
    this.elicitCount += 1;
    const key = `elicit-${this.elicitCount}`;

    const recorded = this.responses[key];
    if (recorded) return toElicitResult(recorded);

    if (!this.supportsElicitation()) {
      throw new MissingClientCapabilityError(
        { elicitation: { form: {} } },
        'This request requires the `elicitation` client capability',
      );
    }

    this.pending[key] = {
      method: 'elicitation/create',
      params: {
        message: pending.message,
        requestedSchema: pending.requestedSchema,
        ...(pending.mode ? { mode: pending.mode } : {}),
        ...(pending.url ? { url: pending.url } : {}),
      },
    };

    throw new InputRequiredSignal(this.pending, encodeRequestState(this.responses));
  }
}

/**
 * Build the `InputRequiredResult` body for a raised signal.
 *
 * `resultType` is set here rather than by the generic result decorator because
 * an interim result is precisely the case the decorator must not overwrite.
 */
export function buildInputRequiredResult(signal: InputRequiredSignal): Record<string, unknown> {
  return {
    resultType: 'input_required',
    inputRequests: signal.inputRequests,
    requestState: signal.requestState,
  };
}
