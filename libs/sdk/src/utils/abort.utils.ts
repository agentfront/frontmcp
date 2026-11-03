/**
 * An AbortController that also aborts when the given signal does: what a call's own timeout aborts, while the
 * request's signal still stops it.
 */
export function linkedAbortController(signal: AbortSignal | undefined): AbortController {
  const controller = new AbortController();
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  return controller;
}
