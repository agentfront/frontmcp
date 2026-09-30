import { httpMock } from '../http-mock';

describe('httpMock', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    httpMock.disable();
    globalThis.fetch = realFetch;
  });

  it('restore() puts the original fetch back once the last interceptor is restored', () => {
    const interceptor = httpMock.interceptor();
    expect(globalThis.fetch).not.toBe(realFetch);
    interceptor.restore();
    expect(globalThis.fetch).toBe(realFetch);
    expect(httpMock.isEnabled()).toBe(false);
  });

  it('keeps fetch mocked while another interceptor is still active', () => {
    const a = httpMock.interceptor();
    const b = httpMock.interceptor();
    a.restore();
    expect(globalThis.fetch).not.toBe(realFetch);
    b.restore();
    expect(globalThis.fetch).toBe(realFetch);
  });

  it('honours { times } passed as the third argument of get()', async () => {
    const interceptor = httpMock.interceptor();
    interceptor.get('https://api.test/once', { ok: true }, { times: 1 });

    const first = await fetch('https://api.test/once');
    expect(await first.json()).toEqual({ ok: true });
    await expect(fetch('https://api.test/once')).rejects.toThrow('No HTTP mock found');
  });

  it('matches method, headers and body of a fetch(new Request(...)) call', async () => {
    const interceptor = httpMock.interceptor();
    const handle = interceptor.post('https://api.test/items', { body: { id: 1 }, status: 201 });

    const response = await fetch(
      new Request('https://api.test/items', {
        method: 'POST',
        headers: { 'x-token': 'abc', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'widget' }),
      }),
    );

    expect(response.status).toBe(201);
    const [call] = handle.calls();
    expect(call.method).toBe('POST');
    expect(call.headers['x-token']).toBe('abc');
    expect(call.body).toEqual({ name: 'widget' });
  });

  it('lets init override the Request method and headers', async () => {
    const interceptor = httpMock.interceptor();
    const handle = interceptor.put('https://api.test/x', { ok: true });
    await fetch(new Request('https://api.test/x'), { method: 'PUT', headers: { a: 'b' } });
    expect(handle.calls()[0].headers['a']).toBe('b');
  });

  describe('bare body objects', () => {
    it('treats an object with a non-HTTP "status" value as the body', async () => {
      const interceptor = httpMock.interceptor();
      interceptor.get('https://api.test/job', { status: 'active', id: 7 });
      const response = await fetch('https://api.test/job');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'active', id: 7 });
    });

    it('treats an object with an out-of-range numeric "status" as the body instead of throwing RangeError', async () => {
      const interceptor = httpMock.interceptor();
      interceptor.get('https://api.test/job', { status: 0, id: 7 });
      const response = await fetch('https://api.test/job');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 0, id: 7 });
    });

    it('still accepts a real response descriptor', async () => {
      const interceptor = httpMock.interceptor();
      interceptor.get('https://api.test/missing', { status: 404, body: { error: 'nope' } });
      const response = await fetch('https://api.test/missing');
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'nope' });
    });

    it('treats arrays as bodies', async () => {
      const interceptor = httpMock.interceptor();
      interceptor.get('https://api.test/list', [1, 2, 3] as unknown as Record<string, unknown>);
      const response = await fetch('https://api.test/list');
      expect(await response.json()).toEqual([1, 2, 3]);
    });
  });
});
