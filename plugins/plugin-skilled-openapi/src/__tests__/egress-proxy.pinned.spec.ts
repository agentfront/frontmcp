/**
 * Through a real proxy, with undici's `ProxyAgent`: the proxy is asked to connect to the address the
 * outbound check approved, and the API still sees its own hostname in `Host`. The host is a `.test`
 * name, which no resolver answers, so only a request the proxy sent to the address arrives.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import * as net from 'node:net';

import { proxiedFetch } from '../executor/egress-proxy';

let api: Server;
let proxy: Server;
let apiPort: number;
let proxyUrl: string;
const apiRequests: IncomingHttpHeaders[] = [];
const connectTargets: string[] = [];
/** An address the proxy refuses to tunnel to, as one without a route to it would. */
const REFUSED_ADDRESS = '127.0.0.2';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

beforeEach(() => {
  apiRequests.length = 0;
  connectTargets.length = 0;
});

beforeAll(async () => {
  api = createServer((request, response) => {
    apiRequests.push(request.headers);
    response.end('ok');
  });
  proxy = createServer();
  proxy.on('connect', (request, clientSocket: net.Socket, head: Buffer) => {
    const target = request.url ?? '';
    connectTargets.push(target);
    if (target.startsWith(REFUSED_ADDRESS)) {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const separator = target.lastIndexOf(':');
    const upstream = net.connect(Number(target.slice(separator + 1)), target.slice(0, separator), () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  apiPort = await listen(api);
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
});

afterAll(async () => {
  await close(proxy);
  await close(api);
});

it('connects through the proxy to the checked address, with the hostname in Host', async () => {
  const send = await proxiedFetch(proxyUrl, [{ address: '127.0.0.1', family: 4 }]);

  const response = await send(`http://api.pinned.test:${apiPort}/v1/items`);

  expect(await response.text()).toBe('ok');
  expect(connectTargets).toEqual([`127.0.0.1:${apiPort}`]);
  expect(apiRequests).toEqual([expect.objectContaining({ host: `api.pinned.test:${apiPort}` })]);
});

it('moves to the next approved address when the proxy refuses the tunnel to the first', async () => {
  const send = await proxiedFetch(proxyUrl, [
    { address: REFUSED_ADDRESS, family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]);

  const response = await send(`http://fallback.pinned.test:${apiPort}/v1/items`);

  expect(await response.text()).toBe('ok');
  expect(connectTargets).toEqual([`${REFUSED_ADDRESS}:${apiPort}`, `127.0.0.1:${apiPort}`]);
  expect(apiRequests).toEqual([expect.objectContaining({ host: `fallback.pinned.test:${apiPort}` })]);
});
