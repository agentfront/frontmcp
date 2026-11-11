import type { JsonRpcFrame } from './stdio-framer';
import type { BridgeLogger } from './types';

/** Hand the frame of each `data:` line of an SSE body to `deliver`, until the body ends. */
export async function relaySseFrames(
  body: ReadableStream<Uint8Array>,
  deliver: (frame: JsonRpcFrame) => void | Promise<void>,
  log: BridgeLogger,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line.startsWith('data:')) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      try {
        await deliver(JSON.parse(json) as JsonRpcFrame);
      } catch (err) {
        log.warn('sse-parse-error', { error: (err as Error).message, raw: json.slice(0, 200) });
      }
    }
  }
}
