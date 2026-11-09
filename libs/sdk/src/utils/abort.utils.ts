/**
 * An AbortController that also aborts when the given signal does: what a call's own timeout aborts, while the
 * request's signal still stops it.
 */
export function linkedAbortController(signal: AbortSignal | undefined): AbortController {
  return detachableAbortController(signal).controller;
}

/** A {@link linkedAbortController} with `unlink()`, which stops it following the given signal. */
export function detachableAbortController(signal: AbortSignal | undefined): {
  controller: AbortController;
  unlink: () => void;
} {
  const controller = new AbortController();
  const followSignal = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', followSignal, { once: true });
  return { controller, unlink: () => signal?.removeEventListener('abort', followSignal) };
}
