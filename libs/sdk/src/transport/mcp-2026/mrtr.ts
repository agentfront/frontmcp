/**
 * Multi Round-Trip Requests (MRTR) — protocol 2026-07-28, SEP-2322.
 *
 * ## How a round trip works
 *
 * 1. The tool calls `this.elicit(...)` / `this.sample(...)` / `this.listRoots()`.
 *    No response is recorded for that call yet, so the exchange records the
 *    pending request and throws {@link InputRequiredSignal}.
 * 2. The dispatcher turns the signal into an `InputRequiredResult`
 *    (`resultType: "input_required"`) carrying `inputRequests` and an opaque,
 *    integrity-protected `requestState`.
 * 3. The client gathers the input and re-issues the SAME request (with a NEW
 *    JSON-RPC id) carrying `inputResponses` + the echoed `requestState`.
 * 4. The entry runs again from the top. This time each call finds a recorded
 *    answer and returns it inline, so execution proceeds.
 *
 * Entries are therefore replayed, not resumed — which is why keys are derived
 * from the call ORDER (`elicit-1`, `sampling-1`, `roots-1`, …) rather than
 * randomly: the second run must line its calls up with the first run's answers.
 *
 * `requestState` accumulates every answer gathered so far, so a multi-step tool
 * converges even if the client only echoes the most recent `inputResponses`.
 * It is signed and bound to the caller and the originating request — see
 * {@link ./request-state}.
 */
import type { InputRequests, InputResponses } from '@frontmcp/protocol';

import { type ElicitStatus } from '../../elicitation';
import { InputRequiredSignal, MissingClientCapabilityError } from '../../errors';
import { encodeRequestState, type RequestStateBinding } from './request-state';

/** Requests the client may be asked to fulfil, and the capability each needs. */
const CAPABILITY_FOR_KIND = {
  elicitation: { capability: 'elicitation', required: { elicitation: { form: {} } } },
  sampling: { capability: 'sampling', required: { sampling: {} } },
  roots: { capability: 'roots', required: { roots: {} } },
} as const;

export type MrtrRequestKind = keyof typeof CAPABILITY_FOR_KIND;

/** Shape recorded for a pending elicitation before it becomes an input request. */
export interface PendingElicitation {
  message: string;
  requestedSchema: Record<string, unknown>;
  mode?: 'form' | 'url';
  url?: string;
}

/** Parameters for a `sampling/createMessage` input request. */
export interface PendingSampling {
  messages: unknown[];
  maxTokens: number;
  systemPrompt?: string;
  modelPreferences?: Record<string, unknown>;
  temperature?: number;
  stopSequences?: string[];
  includeContext?: 'none' | 'thisServer' | 'allServers';
  metadata?: Record<string, unknown>;
}

/** The client's answer to a `sampling/createMessage` request. */
export interface SamplingAnswer {
  role: string;
  content: unknown;
  model?: string;
  stopReason?: string;
}

/** The client's answer to a `roots/list` request. */
export interface RootsAnswer {
  roots: Array<{ uri: string; name?: string }>;
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

/**
 * Per-request bookkeeping for one MRTR exchange.
 *
 * Lives on the `FrontMcpContext` for the duration of a single dispatch, so
 * `elicit()` / `sample()` / `listRoots()` deep inside an entry can reach it
 * without threading it through every flow stage.
 */
export class MrtrExchange {
  /** Answers already supplied by the client, keyed by input-request key. */
  private readonly responses: InputResponses;

  /** Requests raised during THIS run that the client still has to answer. */
  private readonly pending: InputRequests = {};

  /** Per-kind call counters, used to derive stable keys across a replay. */
  private readonly counters: Record<MrtrRequestKind, number> = { elicitation: 0, sampling: 0, roots: 0 };

  readonly clientCapabilities: Record<string, unknown>;

  private readonly binding: RequestStateBinding;

  constructor(params: {
    /** `inputResponses` from the request params. */
    inputResponses?: InputResponses;
    /** Answers carried over from earlier rounds via a verified `requestState`. */
    carriedResponses?: InputResponses;
    /** Capabilities the client declared for this request. */
    clientCapabilities: Record<string, unknown>;
    /** Principal + request digest that new state will be bound to. */
    binding: RequestStateBinding;
  }) {
    // Fresh `inputResponses` win over carried ones for the same key: the client
    // is answering the question we just asked.
    this.responses = { ...(params.carriedResponses ?? {}), ...(params.inputResponses ?? {}) };
    this.clientCapabilities = params.clientCapabilities;
    this.binding = params.binding;
  }

  /** True when the client declared the capability a given request kind needs. */
  supports(kind: MrtrRequestKind): boolean {
    const declared = this.clientCapabilities[CAPABILITY_FOR_KIND[kind].capability];
    return typeof declared === 'object' && declared !== null;
  }

  /** True when the client declared support for elicitation in this request. */
  supportsElicitation(): boolean {
    return this.supports('elicitation');
  }

  /**
   * Look up a recorded answer for the next call of `kind`, or record the
   * request and unwind.
   *
   * The spec forbids asking for something the client never said it supports, so
   * an undeclared capability fails fast with `-32021` rather than emitting an
   * `inputRequests` entry the client cannot honor.
   */
  private resolve<T>(
    kind: MrtrRequestKind,
    method: string,
    params: Record<string, unknown>,
    map: (raw: Record<string, unknown>) => T,
  ): T {
    this.counters[kind] += 1;
    const key = `${kind}-${this.counters[kind]}`;

    const recorded = this.responses[key];
    if (recorded) return map(recorded);

    if (!this.supports(kind)) {
      throw new MissingClientCapabilityError(
        CAPABILITY_FOR_KIND[kind].required,
        `This request requires the \`${CAPABILITY_FOR_KIND[kind].capability}\` client capability`,
      );
    }

    this.pending[key] = { method, params };
    throw new InputRequiredSignal(this.pending, encodeRequestState(this.responses, this.binding));
  }

  /** Resolve the next `elicit()` call. */
  resolveElicitation(pending: PendingElicitation): { status: ElicitStatus; content?: unknown } {
    return this.resolve(
      'elicitation',
      'elicitation/create',
      {
        message: pending.message,
        requestedSchema: pending.requestedSchema,
        ...(pending.mode ? { mode: pending.mode } : {}),
        ...(pending.url ? { url: pending.url } : {}),
      },
      toElicitResult,
    );
  }

  /** Resolve the next `sample()` call. */
  resolveSampling(pending: PendingSampling): SamplingAnswer {
    const params: Record<string, unknown> = {
      messages: pending.messages,
      maxTokens: pending.maxTokens,
    };
    for (const key of ['systemPrompt', 'modelPreferences', 'temperature', 'stopSequences', 'metadata'] as const) {
      if (pending[key] !== undefined) params[key] = pending[key];
    }
    // `thisServer` / `allServers` are deprecated in this revision; only forward
    // `includeContext` when the client declared it supports context inclusion.
    const samplingCaps = this.clientCapabilities['sampling'] as { context?: unknown } | undefined;
    if (pending.includeContext !== undefined && (pending.includeContext === 'none' || samplingCaps?.context)) {
      params['includeContext'] = pending.includeContext;
    }

    return this.resolve('sampling', 'sampling/createMessage', params, (raw) => raw as unknown as SamplingAnswer);
  }

  /** Resolve the next `listRoots()` call. */
  resolveRoots(): RootsAnswer {
    return this.resolve('roots', 'roots/list', {}, (raw) => ({
      roots: Array.isArray(raw['roots']) ? (raw['roots'] as RootsAnswer['roots']) : [],
    }));
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
