/**
 * Over HTTP, a session's request goes on the connection that answered its identity challenge (#1314). When that
 * connection closed in between, the request fails without being sent: whatever answers a new connection proved nothing.
 */
import * as http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import { deriveSharedServerKeys, proveSharedServerIdentity } from '@frontmcp/auth';
import { base64urlEncode, randomBytes } from '@frontmcp/utils';

import { SharedServerIdentityError } from '../../errors/shared-server.errors';
import { fetchAfterIdentity, httpEndpoint, SHARED_IDENTIFY_PATH } from '../shared-endpoint';

const { proofKey } = deriveSharedServerKeys(base64urlEncode(randomBytes(32)));

describe('fetchAfterIdentity over HTTP', () => {
  let server: http.Server;
  let port: number;
  let received: Array<{ path: string; socket: Socket }>;
  let closeAfterAnswering: boolean;

  beforeEach(async () => {
    received = [];
    closeAfterAnswering = false;
    server = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString()));
      request.on('end', () => {
        received.push({ path: request.url ?? '', socket: request.socket });
        if (request.url !== SHARED_IDENTIFY_PATH) {
          response.statusCode = 204;
          response.end();
          return;
        }
        const { nonce } = JSON.parse(body) as { nonce: string };
        const statement = { endpoint: httpEndpoint(port).id, nonce, version: '1.0.0' };
        if (closeAfterAnswering) response.setHeader('connection', 'close');
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ proof: proveSharedServerIdentity(proofKey, statement), version: '1.0.0' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const send = () =>
    fetchAfterIdentity(httpEndpoint(port), proofKey)(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: '{}' });

  it('sends the request on the connection that answered the challenge', async () => {
    const response = await send();

    expect(response.status).toBe(204);
    expect(received.map(({ path }) => path)).toEqual([SHARED_IDENTIFY_PATH, '/mcp']);
    expect(received[1].socket).toBe(received[0].socket);
  });

  it('fails the request, unsent, when the connection that answered has closed', async () => {
    closeAfterAnswering = true;

    await expect(send()).rejects.toBeInstanceOf(SharedServerIdentityError);
    expect(received.map(({ path }) => path)).toEqual([SHARED_IDENTIFY_PATH]);
  });

  it('challenges each request on a connection of its own', async () => {
    await send();
    await send();

    const [firstChallenge, firstRequest, secondChallenge, secondRequest] = received.map(({ socket }) => socket);
    expect(firstRequest).toBe(firstChallenge);
    expect(secondRequest).toBe(secondChallenge);
    expect(secondChallenge).not.toBe(firstChallenge);
  });
});
