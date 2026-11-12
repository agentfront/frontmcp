import { SseEventSplitter } from '../sse-event-splitter';

/** The events of a whole stream received at once, split on blank lines after normalizing line endings. */
function eventsOfWholeStream(stream: string): { events: string[]; remainder: string } {
  const endsWithCarriageReturn = stream.endsWith('\r');
  const normalized = (endsWithCarriageReturn ? stream.slice(0, -1) : stream).replace(/\r\n?/g, '\n');
  const events = normalized.split('\n\n');
  const remainder = events.pop() ?? '';
  return { events, remainder: endsWithCarriageReturn ? `${remainder}\r` : remainder };
}

/** Feed the stream to a splitter in chunks of the given sizes, repeated until the stream ends. */
function eventsOfChunkedStream(stream: string, sizes: number[]): { events: string[]; remainder: string } {
  const splitter = new SseEventSplitter();
  const events: string[] = [];
  for (let offset = 0, index = 0; offset < stream.length; index++) {
    const size = sizes[index % sizes.length];
    events.push(...splitter.push(stream.slice(offset, offset + size)));
    offset += size;
  }
  return { events, remainder: splitter.remainder() };
}

describe('SseEventSplitter', () => {
  const stream =
    ': keep-alive\r\n\r\nevent: endpoint\r\ndata: /message?sessionId=1\r\n\r\n' +
    'event: message\ndata: {"a":1}\n\n\n\ndata: line one\rdata: line two\r\r' +
    'data: {"b":2}\r\n\r\n\r\ndata: partial\r';

  it.each([[[1]], [[2]], [[3]], [[5, 1, 7]], [[13]], [[64]], [[stream.length]]])(
    'gives the events of the whole stream when it arrives in chunks of %p characters',
    (sizes) => {
      expect(eventsOfChunkedStream(stream, sizes)).toEqual(eventsOfWholeStream(stream));
    },
  );

  it('keeps a carriage return at the end of a chunk until it knows whether a line feed follows', () => {
    const splitter = new SseEventSplitter();
    expect(splitter.push('data: a\r')).toEqual([]);
    expect(splitter.push('\n\r')).toEqual([]);
    expect(splitter.push('\ndata: b')).toEqual(['data: a']);
    expect(splitter.remainder()).toBe('data: b');
  });

  it('splits a large event received one character at a time, reading each character once', () => {
    const data = `data: ${'x'.repeat(300000)}\n\n`;
    const splitter = new SseEventSplitter();
    const events: string[] = [];
    for (const character of data) events.push(...splitter.push(character));
    expect(events).toEqual([data.slice(0, -2)]);
    expect(splitter.remainder()).toBe('');
  });
});
