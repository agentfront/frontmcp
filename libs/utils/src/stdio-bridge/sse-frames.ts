import type { JsonRpcFrame } from './stdio-framer';
import type { BridgeLogger } from './types';

/**
 * Hand the frame of each event of an SSE body to `deliver`, until the body ends. An event is its `data:` lines up
 * to a blank line, joined by newlines; the event a body ends in is delivered without one.
 */
export async function relaySseFrames(
  body: ReadableStream<Uint8Array>,
  deliver: (frame: JsonRpcFrame) => void | Promise<void>,
  log: BridgeLogger,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventData: string[] = [];

  /** Deliver the frame of the event read so far, when it has data. */
  async function deliverEvent(): Promise<void> {
    const json = eventData.join('\n').trim();
    eventData = [];
    if (!json) return;
    try {
      await deliver(JSON.parse(json) as JsonRpcFrame);
    } catch (err) {
      log.warn('sse-parse-error', { error: (err as Error).message, raw: json.slice(0, 200) });
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      await deliverEvent();
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line === '') await deliverEvent();
      else if (line.startsWith('data:')) eventData.push(line.slice(5).trim());
    }
  }
}
