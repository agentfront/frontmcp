import { FlowHooksOf, httpRespond } from '../common';
import { SHARED_EXITING, SHARED_STATE_HEADER } from './shared-endpoint';

const { Will } = FlowHooksOf('http:request');
const RouteHook = FlowHooksOf('http:route');
const HostRouteHook = FlowHooksOf('http:ip-filter');

/** The answer to a request that reaches a shared server once it is exiting: sent again, it reaches the next one. */
export function exitingResponse(): ReturnType<typeof httpRespond.json> {
  return httpRespond.json(
    { error: 'the shared server is exiting' },
    { status: 503, headers: { 'retry-after': '1', connection: 'close', [SHARED_STATE_HEADER]: SHARED_EXITING } },
  );
}

/** The Node response of a request: it tells when the request is over, and can be cut off. */
interface TrackedResponse {
  once?(event: 'close', listener: () => void): unknown;
  destroy?(): unknown;
}

/** The part of a route's run the lifecycle reads: its Node response, and how to answer. */
interface HttpRouteRun {
  readonly rawInput: { request?: { method?: string }; response?: TrackedResponse };
  respond(output: ReturnType<typeof httpRespond.json>): void;
}

/** The part of an `http:request` run the lifecycle reads: whether it is authorized, its method and Node response, and how to answer. */
interface HttpRequestRun extends HttpRouteRun {
  readonly state: { get(key: 'verifyResult'): { kind: string } | undefined };
}

/**
 * How long a shared server has gone without a request, and its exit: once asked to exit, it answers every new
 * request 503 with `x-frontmcp-shared-server: exiting`, so its sessions send it to the next server instead. Only a
 * request that carries the token, a request to one of its routes, or an identity challenge, counts as activity. A
 * notification stream a session holds open (its `GET`) keeps the server from being idle, and is cut off, not waited
 * for, when the server exits; a route's request, its event streams included, is waited for.
 */
export class SharedServerLifecycle {
  #inFlight = 0;
  readonly #streams = new Set<TrackedResponse>();
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
    for (const stream of this.#streams) stream.destroy?.();
  }

  /** Count a session's identity challenge as activity: a session that just found the server is about to use it. */
  touch(): void {
    this.#lastActivity = Date.now();
  }

  /** How long no request has been in flight and no notification stream open, in ms. */
  idleFor(now = Date.now()): number {
    return this.#inFlight > 0 || this.#streams.size > 0 ? 0 : now - this.#lastActivity;
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
    const { request, response } = run.rawInput;
    if (request?.method === 'GET' && typeof response?.once === 'function') {
      this.holdStream(response);
      return;
    }
    this.startRequest(response);
  }

  /** A request an `@HttpRoute` admitted, people pages included. */
  @RouteHook.Will('handle')
  trackRouteRequest(run: HttpRouteRun): void {
    this.trackRoute(run);
  }

  /** A request to a route the host mounts (`http.routes`, channel webhooks). */
  @HostRouteHook.Will('checkIpFilter')
  trackHostRouteRequest(run: HttpRouteRun): void {
    this.trackRoute(run);
  }

  private trackRoute(run: HttpRouteRun): void {
    if (this.isExiting) run.respond(exitingResponse());
    this.startRequest(run.rawInput.response);
  }

  private startRequest(response: TrackedResponse | undefined): void {
    this.#inFlight++;
    this.#lastActivity = Date.now();
    if (typeof response?.once === 'function') response.once('close', () => this.finishRequest());
    else this.finishRequest();
  }

  /** Keep a session's notification stream until it closes: it is activity, but no request to wait for at exit. */
  private holdStream(stream: TrackedResponse): void {
    this.#streams.add(stream);
    stream.once?.('close', () => {
      this.#streams.delete(stream);
      this.#lastActivity = Date.now();
    });
  }

  private finishRequest(): void {
    this.#inFlight--;
    this.#lastActivity = Date.now();
    if (this.#inFlight > 0) return;
    for (const done of [...this.#settledWaiters]) done();
  }
}
