/**
 * The SSE body of a streamable-HTTP answer, read as the frames of its events: an event is its `data:` lines up to
 * a blank line, joined by newlines.
 */
import { relaySseFrames } from '../sse-frames';
import type { JsonRpcFrame } from '../stdio-framer';
import { recordingLog } from './helpers/fake-mcp-server';

const listChanged: JsonRpcFrame = { jsonrpc: '2.0', method: 'notifications/tools/list_changed' };
const logLine: JsonRpcFrame = { jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } };

/** An SSE body that arrives in the given chunks, then ends. */
function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

/** The frames `relaySseFrames` delivers for a body, with the log it wrote to. */
async function framesOf(chunks: string[]): Promise<{ frames: JsonRpcFrame[]; log: ReturnType<typeof recordingLog> }> {
  const frames: JsonRpcFrame[] = [];
  const log = recordingLog();
  await relaySseFrames(bodyOf(chunks), (frame) => void frames.push(frame), log);
  return { frames, log };
}

describe('relaySseFrames', () => {
  it('delivers the frame of each event once, at its blank line', async () => {
    const { frames } = await framesOf([
      `event: message\ndata: ${JSON.stringify(listChanged)}\n\nevent: message\ndata: ${JSON.stringify(logLine)}\n\n`,
    ]);

    expect(frames).toEqual([listChanged, logLine]);
  });

  it('joins the data lines of one event before it parses them', async () => {
    const { frames, log } = await framesOf([
      'data: {"jsonrpc":"2.0",\ndata: "method":"notifications/tools/list_changed"}\n\n',
    ]);

    expect(frames).toEqual([listChanged]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('reads an event that arrives in several chunks, with CRLF line ends', async () => {
    const event = `data: ${JSON.stringify(logLine)}\r\n\r\n`;
    const { frames } = await framesOf([event.slice(0, 9), event.slice(9, 30), event.slice(30)]);

    expect(frames).toEqual([logLine]);
  });

  it('delivers the event a body ends in without a blank line', async () => {
    const { frames } = await framesOf([`data: ${JSON.stringify(listChanged)}\n`]);

    expect(frames).toEqual([listChanged]);
  });

  it('delivers nothing for a comment, an event with no data, or a line cut off by the end of the body', async () => {
    const { frames, log } = await framesOf([': keep-alive\n\nevent: ping\n\ndata:\n\ndata: {"jsonrpc":"2.0"']);

    expect(frames).toEqual([]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('warns about an event that is not JSON, and delivers the next one', async () => {
    const { frames, log } = await framesOf([`data: not json\n\ndata: ${JSON.stringify(listChanged)}\n\n`]);

    expect(frames).toEqual([listChanged]);
    expect(log.warn.mock.calls).toEqual([['sse-parse-error', expect.objectContaining({ raw: 'not json' })]]);
  });
});
