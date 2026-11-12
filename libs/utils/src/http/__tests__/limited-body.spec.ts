import { readBodyWithLimit, readTextWithLimit, ResponseTooLargeError } from '../limited-body';

function streamOf(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
}

describe('readBodyWithLimit', () => {
  it('returns a body within the limit', async () => {
    const bytes = await readBodyWithLimit(new Response('hello'), 5);
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });

  it('returns an empty body for a response without one', async () => {
    const bytes = await readBodyWithLimit(new Response(null, { status: 204 }), 0);
    expect(bytes.byteLength).toBe(0);
  });

  it('refuses a declared Content-Length above the limit before reading', async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        pulled = true;
      },
    });
    const response = { headers: new Headers({ 'content-length': '100' }), body };
    await expect(readBodyWithLimit(response, 10)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(pulled).toBe(false);
  });

  it('stops reading and cancels the stream once the total passes the limit', async () => {
    let cancelled = false;
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced++;
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    // No Content-Length: a body that never ends must still stop at the limit.
    await expect(readBodyWithLimit({ headers: new Headers(), body }, 10)).rejects.toThrow(
      'Response body exceeds the limit of 10 bytes',
    );
    expect(cancelled).toBe(true);
    expect(produced).toBeLessThanOrEqual(4);
  });

  it('accepts a body of exactly the limit split over chunks', async () => {
    const body = streamOf([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]);
    const bytes = await readBodyWithLimit({ headers: new Headers(), body }, 5);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it('ignores a Content-Length that is not a number and checks the bytes instead', async () => {
    const body = streamOf([new Uint8Array(6)]);
    await expect(
      readBodyWithLimit({ headers: new Headers({ 'content-length': 'abc' }), body }, 5),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('checks a look-alike response without a stream after reading it', async () => {
    await expect(readBodyWithLimit({ text: async () => 'abcdef' }, 5)).rejects.toBeInstanceOf(ResponseTooLargeError);
    const bytes = await readBodyWithLimit({ text: async () => 'abc' }, 5);
    expect(new TextDecoder().decode(bytes)).toBe('abc');
  });

  it('refuses a limit that is not a non-negative finite number', async () => {
    await expect(readBodyWithLimit(new Response('x'), -1)).rejects.toBeInstanceOf(RangeError);
    await expect(readBodyWithLimit(new Response('x'), Number.NaN)).rejects.toBeInstanceOf(RangeError);
  });
});

describe('readTextWithLimit', () => {
  it('decodes UTF-8 and counts bytes, not characters', async () => {
    // Four characters, eight bytes.
    await expect(readTextWithLimit(new Response('éééé'), 7)).rejects.toBeInstanceOf(ResponseTooLargeError);
    await expect(readTextWithLimit(new Response('éééé'), 8)).resolves.toBe('éééé');
  });
});
