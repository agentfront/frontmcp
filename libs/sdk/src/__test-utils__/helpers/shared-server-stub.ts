import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createSharedServerNonce, deriveSharedServerKeys, proveSharedServerIdentity } from '@frontmcp/auth';
import { base64urlEncode, randomBytes } from '@frontmcp/utils';

import { httpEndpoint, SHARED_IDENTIFY_PATH, unixEndpoint, type SharedEndpoint } from '../../shared/shared-endpoint';

/** How the stub answers an identity challenge: as the real server would, or as one of the ways a squatter might. */
export type StubBehavior = 'prove' | 'garbage' | 'replay' | 'stale' | 'other-endpoint' | 'error';

export interface StubRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface IdentityStub {
  endpoint: SharedEndpoint;
  port: number | undefined;
  requests: StubRequest[];
  close(): Promise<void>;
}

/** An HTTP server answering `/.well-known/frontmcp-shared-server` for `secret`'s proof key, and recording every request. */
export async function startIdentityStub(options: {
  secret: string;
  behavior: StubBehavior;
  socketPath?: string;
  port?: number;
}): Promise<IdentityStub> {
  const { proofKey } = deriveSharedServerKeys(options.secret);
  const requests: StubRequest[] = [];
  const recordedNonce = createSharedServerNonce();

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
      if (req.url !== SHARED_IDENTIFY_PATH) {
        res.statusCode = 204;
        res.end();
        return;
      }
      const { nonce } = JSON.parse(body) as { nonce: string };
      const proof = proofFor(options.behavior, endpoint.id, nonce);
      if (proof === undefined) {
        res.statusCode = 500;
        res.end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ proof }));
    });
  });

  function proofFor(behavior: StubBehavior, endpointId: string, nonce: string): string | undefined {
    switch (behavior) {
      case 'prove':
        return proveSharedServerIdentity(proofKey, endpointId, nonce);
      case 'garbage':
        return base64urlEncode(randomBytes(32));
      case 'replay':
        return proveSharedServerIdentity(proofKey, endpointId, recordedNonce);
      case 'stale':
        return proveSharedServerIdentity(
          deriveSharedServerKeys(base64urlEncode(randomBytes(32))).proofKey,
          endpointId,
          nonce,
        );
      case 'other-endpoint':
        return proveSharedServerIdentity(proofKey, `${endpointId}0`, nonce);
      case 'error':
        return undefined;
    }
  }

  await new Promise<void>((resolve) => {
    if (options.socketPath) server.listen(options.socketPath, resolve);
    else server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const port = options.socketPath ? undefined : (server.address() as AddressInfo).port;
  const endpoint = port === undefined ? unixEndpoint(options.socketPath as string) : httpEndpoint(port);
  return {
    endpoint,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
