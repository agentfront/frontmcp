/** How long an MCP stream stays quiet before it sends a keep-alive comment, unless `transport.sse.heartbeatMs` says otherwise. */
export const DEFAULT_STREAM_HEARTBEAT_MS = 15_000;

/** An SSE comment: every reader ignores it, and the bytes reset a proxy's idle timer. */
export const KEEP_ALIVE_COMMENT = ': keep-alive\n\n';

const KEEP_ALIVE_FRAME = new TextEncoder().encode(KEEP_ALIVE_COMMENT);

/** `transport.sse.heartbeatMs` in milliseconds; `0` when keep-alives are off. */
export function streamHeartbeatMs(transport: { sse?: { heartbeatMs?: number | false } } | undefined): number {
  const configured = transport?.sse?.heartbeatMs;
  if (configured === undefined) return DEFAULT_STREAM_HEARTBEAT_MS;
  return configured === false ? 0 : configured;
}

/** `frames` with a keep-alive comment after each quiet `idleMs`; a frame is a whole event, so none is ever split. */
export function withKeepAlive(frames: AsyncIterable<Uint8Array>, idleMs: number): AsyncIterable<Uint8Array> {
  if (idleMs <= 0) return frames;
  return {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      const source = frames[Symbol.asyncIterator]();
      let pending: Promise<IteratorResult<Uint8Array>> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let ended = false;
      let stopWaiting: () => void = () => undefined;
      const stopped = new Promise<'stopped'>((resolve) => (stopWaiting = () => resolve('stopped')));
      return {
        next: async () => {
          if (ended) return { value: undefined, done: true };
          const step = (pending ??= source.next());
          const idle = new Promise<'idle'>((resolve) => {
            timer = setTimeout(() => resolve('idle'), idleMs);
            timer.unref?.();
          });
          let outcome: IteratorResult<Uint8Array> | 'idle' | 'stopped';
          try {
            outcome = await Promise.race([step, idle, stopped]);
          } catch (error) {
            pending = undefined;
            throw error;
          } finally {
            clearTimeout(timer);
          }
          if (ended || outcome === 'stopped') return { value: undefined, done: true };
          if (outcome === 'idle') return { value: KEEP_ALIVE_FRAME, done: false };
          pending = undefined;
          if (outcome.done) ended = true;
          return outcome;
        },
        return: async () => {
          ended = true;
          clearTimeout(timer);
          stopWaiting();
          await source.return?.();
          return { value: undefined, done: true };
        },
      };
    },
  };
}
