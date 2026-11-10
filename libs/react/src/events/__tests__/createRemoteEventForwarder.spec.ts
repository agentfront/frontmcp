/**
 * @jest-environment node
 */
import { createServer, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';

import { createRemoteEventForwarder, RemoteEventForwardError } from '../createRemoteEventForwarder';

interface Received {
  authorization?: string;
  contentType?: string;
  body: Record<string, unknown>;
}

/** Read a request body as JSON. */
function jsonOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let text = '';
    request.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    request.on('end', () => resolve(JSON.parse(text)));
  });
}

describe('createRemoteEventForwarder', () => {
  let server: Server;
  let url: string;
  const received: Received[] = [];

  beforeAll(async () => {
    // A stub of the publish endpoint in bearer mode: 401 without a token, 404 for an unknown event, else 202
    server = createServer(async (request, response) => {
      const body = await jsonOf(request);
      received.push({
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
        body,
      });
      const status = !request.headers.authorization ? 401 : body['name'] === 'unknown' ? 404 : 202;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(status === 202 ? { eventId: body['eventId'] ?? 'evt_1', matched: 3 } : { error: 'no' }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/events/publish`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received.length = 0;
  });

  it("POSTs the event with the user's bearer token and answers the endpoint's 202 body", async () => {
    const forwarder = createRemoteEventForwarder({ url, getToken: async () => 'user-token' });

    const result = await forwarder.forward(
      'cart.checked_out',
      { cartId: 'c-1' },
      { eventId: 'evt_9', audience: { sub: 'ada' } },
    );

    expect(result).toEqual({ eventId: 'evt_9', matched: 3 });
    expect(received).toEqual([
      {
        authorization: 'Bearer user-token',
        contentType: 'application/json',
        body: { name: 'cart.checked_out', data: { cartId: 'c-1' }, eventId: 'evt_9', audience: { sub: 'ada' } },
      },
    ]);
  });

  it('throws the status and body of a refusal, and sends no Authorization without a token', async () => {
    const anonymous = createRemoteEventForwarder({ url, getToken: () => null });
    const signedIn = createRemoteEventForwarder({ url, getToken: () => 'user-token' });

    const unauthorized = await anonymous.forward('cart.checked_out', {}).catch((error: unknown) => error);
    const unknown = await signedIn.forward('unknown', {}).catch((error: unknown) => error);

    expect(received[0].authorization).toBeUndefined();
    expect(unauthorized).toBeInstanceOf(RemoteEventForwardError);
    expect(unauthorized).toMatchObject({ status: 401, body: '{"error":"no"}' });
    expect(unknown).toMatchObject({ status: 404, name: 'RemoteEventForwardError' });
  });

  it('uses the fetch it is given', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('{"eventId":"evt_2","matched":0}', { status: 202 }));
    const forwarder = createRemoteEventForwarder({
      url: 'https://remote/events/publish',
      getToken: () => 't',
      fetch: fetchImpl,
    });

    await expect(forwarder.forward('x', {})).resolves.toEqual({ eventId: 'evt_2', matched: 0 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://remote/events/publish',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
