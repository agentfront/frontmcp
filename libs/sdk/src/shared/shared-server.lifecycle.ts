import { FlowHooksOf, httpRespond } from '../common';
import { SHARED_EXITING, SHARED_STATE_HEADER } from './shared-endpoint';

const { Will } = FlowHooksOf('http:request');

/** The answer to a request that reaches a shared server once it is exiting: sent again, it reaches the next one. */
export function exitingResponse(): ReturnType<typeof httpRespond.json> {
  return httpRespond.json(
    { error: 'the shared server is exiting' },
    { status: 503, headers: { 'retry-after': '1', [SHARED_STATE_HEADER]: SHARED_EXITING } },
  );
}

/** The part of an `http:request` run the lifecycle reads: whether it is authorized, its Node response, and how to answer. */
interface HttpRequestRun {
  readonly rawInput: { response?: { once?(event: 'close', listener: () => void): unknown } };
  readonly state: { get(key: 'verifyResult'): { kind: string } | undefined };
  respond(output: ReturnType<typeof httpRespond.json>): void;
}

/**
 * How long a shared server has gone without a request, and its exit: once asked to exit, it answers every new
 * request 503 with `x-frontmcp-shared-server: exiting`, so its sessions send it to the next server instead. Only a
 * request that carries the token, or an identity challenge, counts as activity.
 */
export class SharedServerLifecycle {
  #inFlight = 0;
  #lastActivity = Date.now();
  #exitReason: string | undefined;
  readonly #settledWaiters = new Set<() => void>();
  #resolveExit: (reason: string) => void = () => undefined;
  /** Resolves with the reason once the server is asked to exit. */
  readonly exiting = new Promise<string>((resolve) => {
    this.#resolveExit = resolve;
  });

  get isExiting(): boolean {
    return this.#exitReason !== undefined;
  }

  /** Ask the server to exit; the first reason wins. */
  exit(reason: string): void {
    if (this.#exitReason !== undefined) return;
    this.#exitReason = reason;
    this.#resolveExit(reason);
  }

  /** Count a session's identity challenge as activity: a session that just found the server is about to use it. */
  touch(): void {
    this.#lastActivity = Date.now();
  }

  /** How long no request has been in flight, in ms. */
  idleFor(now = Date.now()): number {
    return this.#inFlight > 0 ? 0 : now - this.#lastActivity;
  }

  /** Resolves once no request is in flight, or after `timeoutMs`. */
  settled(timeoutMs: number): Promise<void> {
    if (this.#inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.#settledWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.#settledWaiters.add(done);
    });
  }

  @Will('router')
  trackRequest(run: HttpRequestRun): void {
    if (run.state.get('verifyResult')?.kind !== 'authorized') return;
    if (this.isExiting) run.respond(exitingResponse());
    this.#inFlight++;
    this.#lastActivity = Date.now();
    const response = run.rawInput.response;
    if (typeof response?.once === 'function') response.once('close', () => this.finishRequest());
    else this.finishRequest();
  }

  private finishRequest(): void {
    this.#inFlight--;
    this.#lastActivity = Date.now();
    if (this.#inFlight > 0) return;
    for (const done of [...this.#settledWaiters]) done();
  }
}
