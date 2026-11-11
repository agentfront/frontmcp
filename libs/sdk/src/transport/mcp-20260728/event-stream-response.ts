import { MCP_20260728_META } from '@frontmcp/protocol';

const encoder = new TextEncoder();

/** One JSON-RPC message as an SSE `message` event. */
function frame(message: unknown): Uint8Array {
  return encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

/** A notification of an event stream, as its source yields it. */
interface StreamNotification {
  method: string;
  params: Record<string, unknown>;
}

/**
 * The SSE body of an `events/stream` request: each notification of the stream as it comes, then, when the stream
 * ended, the empty result that closes the request. A reader that stops reading ends the stream at once.
 */
export function eventStreamFrames(
  notifications: AsyncIterable<StreamNotification>,
  requestId: string | number,
): AsyncIterable<Uint8Array> {
  const finalFrame = frame({
    jsonrpc: '2.0',
    id: requestId,
    result: { resultType: 'complete', _meta: { [MCP_20260728_META.subscriptionId]: requestId } },
  });
  return {
    /** Frame each notification, then the final result; returning early ends the source stream too. */
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      const source = notifications[Symbol.asyncIterator]();
      let finished = false;
      return {
        next: async () => {
          if (finished) return { value: undefined, done: true };
          const step = await source.next();
          if (finished) return { value: undefined, done: true };
          if (!step.done) {
            const { method, params } = step.value;
            return { value: frame({ jsonrpc: '2.0', method, params }), done: false };
          }
          finished = true;
          return { value: finalFrame, done: false };
        },
        return: async () => {
          finished = true;
          await source.return?.();
          return { value: undefined, done: true };
        },
      };
    },
  };
}
