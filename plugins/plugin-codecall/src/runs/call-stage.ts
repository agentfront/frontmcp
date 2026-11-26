/**
 * How far the `tools:call-tool` run of a call a script made got, as the flow's own stage hooks report it, never as an
 * error says: a call whose input validation failed never reached its tool, so its run can pause there.
 */
type CallStage = 'dispatched' | 'validating-input' | 'input-valid';

const stageByCallContext = new WeakMap<object, CallStage>();
const inputRefusals = new WeakSet<object>();

/** Follows the call flow CodeCall runs with `ctx`; returns whether it stopped while validating the call's input. */
export function trackCallStage(ctx: object): () => boolean {
  stageByCallContext.set(ctx, 'dispatched');
  return () => stageByCallContext.get(ctx) === 'validating-input';
}

/** From a stage hook of `tools:call-tool`: the call flow run with `ctx` reached `stage`. */
export function markCallStage(ctx: unknown, stage: Exclude<CallStage, 'dispatched'>): void {
  if (typeof ctx === 'object' && ctx !== null && stageByCallContext.has(ctx)) stageByCallContext.set(ctx, stage);
}

/** Marks the error a script's call failed with as a refusal of its input, before the tool ran. */
export function markInputRefusal<T extends object>(error: T): T {
  inputRefusals.add(error);
  return error;
}

/** Whether a call failed with an error {@link markInputRefusal} marked. */
export function isInputRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && inputRefusals.has(error);
}
