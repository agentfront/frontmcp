/**
 * Ends a session on every instance sharing its session store (#1446).
 *
 * Outside distributed mode several instances may hold one session in memory, each having recreated it
 * from the Redis session store they share (#713). A DELETE that lands on one of them ended the session
 * there and in the store, and the others found out only on their next request for it, so their calls in
 * flight for the session ran on after the DELETE answered.
 *
 * Every instance with a Redis session store listens on one channel of that Redis. A DELETE publishes
 * `end-session` there; each other instance closes its transports for the session, which stops the
 * session's calls in flight, and answers `session-ended`. The DELETE answers once every other instance
 * listening on the channel has answered, or, after a bounded wait, with a retryable 503.
 */

import { randomUUID } from '@frontmcp/utils';

import { SessionEndUnconfirmedError } from '../errors/transport.errors';

/** Pub/sub on the Redis of the session store the instances share (`RedisSessionStore`). */
export interface SessionEndPubSub {
  /** Publish on a channel; resolves how many connections listen on it, on every node of a cluster. */
  publish(channel: string, message: string): Promise<number>;
  /** Listen on a channel; resolves once subscribed, with a function that stops listening. */
  subscribe(channel: string, onMessage: (message: string) => void): Promise<() => Promise<void>>;
}

/** Whether a session store can carry the channel (a Redis one can; SQLite and Vercel KV cannot). */
export function isSessionEndPubSub(store: unknown): store is SessionEndPubSub {
  const candidate = store as Partial<SessionEndPubSub> | undefined;
  return typeof candidate?.publish === 'function' && typeof candidate.subscribe === 'function';
}

/** The channel, named under the session store's key prefix. */
export const SESSION_END_CHANNEL = 'session-end';

/** How long a DELETE waits for the other instances to answer. */
export const SESSION_END_CONFIRM_TIMEOUT_MS = 5_000;
/** `Retry-After` of a DELETE whose end is unconfirmed outside distributed mode. */
export const SESSION_END_RETRY_AFTER_SECONDS = 5;

type SessionEndMessage =
  | { kind: 'end-session'; requestId: string; sessionId: string; instanceId: string }
  | { kind: 'session-ended'; requestId: string; sessionId: string; instanceId: string; held: boolean };

interface SessionEndLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface SessionEndChannelOptions {
  pubsub: SessionEndPubSub;
  /** Close this instance's transports for a session, which stops its calls in flight; resolves whether it held one. */
  endLocal(sessionId: string): Promise<boolean>;
  logger: SessionEndLogger;
  /** How long a DELETE waits for the other instances to answer. @default 5000 */
  confirmTimeoutMs?: number;
  /** `Retry-After` of a DELETE they did not all answer in time. @default 5 */
  retryAfterSeconds?: number;
}

interface PendingEnd {
  answered: Set<string>;
  onAnswer(): void;
}

function parse(raw: string): SessionEndMessage | undefined {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const candidate = message as Partial<SessionEndMessage> | null;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.requestId !== 'string' ||
    typeof candidate.sessionId !== 'string' ||
    typeof candidate.instanceId !== 'string'
  ) {
    return undefined;
  }
  return candidate as SessionEndMessage;
}

export class SessionEndChannel {
  /** This process, as the channel's messages name it (several may run on one machine). */
  readonly instanceId = randomUUID();
  private readonly confirmTimeoutMs: number;
  private readonly retryAfterSeconds: number;
  private readonly pending = new Map<string, PendingEnd>();
  private stopListening?: () => Promise<void>;
  private closed = false;

  constructor(private readonly options: SessionEndChannelOptions) {
    this.confirmTimeoutMs = options.confirmTimeoutMs ?? SESSION_END_CONFIRM_TIMEOUT_MS;
    this.retryAfterSeconds = options.retryAfterSeconds ?? SESSION_END_RETRY_AFTER_SECONDS;
  }

  /** Whether this instance listens on the channel: only then can it hear the others answer. */
  get listening(): boolean {
    return this.stopListening !== undefined && !this.closed;
  }

  /** Listen on the channel. */
  async start(): Promise<void> {
    const stop = await this.options.pubsub.subscribe(SESSION_END_CHANNEL, (raw) => this.onMessage(raw));
    if (this.closed) {
      await stop();
      return;
    }
    this.stopListening = stop;
  }

  /** Stop listening; DELETEs waiting for answers stop waiting at their deadline. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const stop = this.stopListening;
    this.stopListening = undefined;
    await stop?.();
  }

  /**
   * Ask every other instance listening on the channel to close the session, and resolve once each one
   * answered that it did (or held none). Does nothing while this instance does not listen.
   *
   * @throws SessionEndUnconfirmedError when some did not answer within the bounded wait.
   */
  async endElsewhere(sessionId: string): Promise<void> {
    if (!this.listening) return;
    const requestId = randomUUID();
    const answered = new Set<string>();
    let onAnswer = (): void => undefined;
    this.pending.set(requestId, { answered, onAnswer: () => onAnswer() });
    try {
      const message: SessionEndMessage = { kind: 'end-session', requestId, sessionId, instanceId: this.instanceId };
      const listeners = await this.publishRequest(sessionId, JSON.stringify(message));
      // This instance listens too, and does not answer itself
      const others = listeners - 1;
      if (others <= 0) return;

      let timer: ReturnType<typeof setTimeout> | undefined;
      const allAnswered = await new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), this.confirmTimeoutMs);
        onAnswer = () => {
          if (answered.size >= others) resolve(true);
        };
        // Answers that came while the publish was counting the listeners
        onAnswer();
      }).finally(() => clearTimeout(timer));
      if (allAnswered) return;

      this.options.logger.warn(
        '[TransportService] Instances holding the session did not confirm in time that they closed it',
        {
          sessionId: sessionId.slice(0, 20),
          unanswered: others - answered.size,
          listening: others,
        },
      );
      throw new SessionEndUnconfirmedError(
        `${others - answered.size} of ${others} other instances`,
        this.retryAfterSeconds,
        `not every instance sharing the session store confirmed within ${this.confirmTimeoutMs}ms that it closed the session`,
        'timed-out',
      );
    } finally {
      this.pending.delete(requestId);
    }
  }

  /** Publish the request; one that fails, or whose listeners cannot all be counted, leaves the end unconfirmed. */
  private async publishRequest(sessionId: string, message: string): Promise<number> {
    try {
      return await this.options.pubsub.publish(SESSION_END_CHANNEL, message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.options.logger.warn('[TransportService] Could not ask the other instances to close the session', {
        sessionId: sessionId.slice(0, 20),
        error: reason,
      });
      throw new SessionEndUnconfirmedError(
        'the instances sharing the session store',
        this.retryAfterSeconds,
        `the request to close the session was not published, or its listeners not all counted: ${reason}`,
        'uncounted',
      );
    }
  }

  private onMessage(raw: string): void {
    const message = parse(raw);
    if (!message || message.instanceId === this.instanceId) return;
    if (message.kind === 'end-session') {
      void this.endHere(message.requestId, message.sessionId);
      return;
    }
    if (message.kind === 'session-ended') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      pending.answered.add(message.instanceId);
      pending.onAnswer();
    }
  }

  /** Close the session here, then answer: an instance that could not close it does not answer. */
  private async endHere(requestId: string, sessionId: string): Promise<void> {
    let held: boolean;
    try {
      held = await this.options.endLocal(sessionId);
    } catch (error) {
      this.options.logger.warn('[TransportService] Failed to close a session deleted through another instance', {
        sessionId: sessionId.slice(0, 20),
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (held) {
      this.options.logger.info('[TransportService] Closed a session deleted through another instance', {
        sessionId: sessionId.slice(0, 20),
      });
    }
    const answer: SessionEndMessage = {
      kind: 'session-ended',
      requestId,
      sessionId,
      instanceId: this.instanceId,
      held,
    };
    try {
      await this.options.pubsub.publish(SESSION_END_CHANNEL, JSON.stringify(answer));
    } catch (error) {
      this.options.logger.warn(
        '[TransportService] Failed to confirm the end of a session to the instance deleting it',
        {
          sessionId: sessionId.slice(0, 20),
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
