import { withIdempotencyKey } from '@frontmcp/sdk';
import { sha256Hex } from '@frontmcp/utils';

/** What the tool handler is told about a call besides its name and arguments: Enclave's `ToolCall`. */
export interface ScriptToolCall {
  /** The call's position in the run, from 0, in the order calls reach the host. */
  callIndex: number;
}

/** The idempotency key of the call at `callIndex` of run `runId`: the same on every replay of the run, another at every other position. */
export function callIdempotencyKey(runId: string, callIndex: number): string {
  return sha256Hex(`codecall:call:${runId}:${callIndex}`);
}

/** The call context of a script's call, marked with its idempotency key, which its tool reads as `this.idempotencyKey`. */
export function withCallIdempotencyKey<T extends object>(ctx: T, runId: string, call: ScriptToolCall | undefined): T {
  return call ? withIdempotencyKey(ctx, callIdempotencyKey(runId, call.callIndex)) : ctx;
}
