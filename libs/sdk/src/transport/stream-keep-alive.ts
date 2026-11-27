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
      // One source read, however many keep-alives go out while it is awaited; its outcome waits here for `next()`.
      let reading = false;
      let read: { result: IteratorResult<Uint8Array> } | { error: unknown } | undefined;
      // Wakes the waiting `next()`: the read settled, the quiet interval passed or the reader returned. One waiter at a
      // time, so a long stream keeps no reaction per frame or per keep-alive on a promise that stays pending.
      let wake: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let ended = false;
      return {
        next: async () => {
          if (ended) return { value: undefined, done: true };
          if (!reading) {
            reading = true;
            void source.next().then(
              (result) => {
                read = { result };
                wake?.();
              },
              (error: unknown) => {
                read = { error };
                wake?.();
              },
            );
          }
          if (!read) {
            await new Promise<void>((resolve) => {
              wake = resolve;
              timer = setTimeout(resolve, idleMs);
              timer.unref?.();
            });
            wake = undefined;
            clearTimeout(timer);
          }
          if (ended) return { value: undefined, done: true };
          if (!read) return { value: KEEP_ALIVE_FRAME, done: false };
          const settled = read;
          read = undefined;
          reading = false;
          if ('error' in settled) throw settled.error;
          if (settled.result.done) ended = true;
          return settled.result;
        },
        return: async () => {
          ended = true;
          clearTimeout(timer);
          wake?.();
          await source.return?.();
          return { value: undefined, done: true };
        },
      };
    },
  };
}
