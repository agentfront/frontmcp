import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createSharedServerNonce, deriveSharedServerKeys, proveSharedServerIdentity } from '@frontmcp/auth';
import { base64urlEncode, randomBytes } from '@frontmcp/utils';

import {
  httpEndpoint,
  SHARED_DRAIN_PATH,
  SHARED_EXITING,
  SHARED_IDENTIFY_PATH,
  SHARED_STATE_HEADER,
  unixEndpoint,
  type SharedEndpoint,
} from '../../shared/shared-endpoint';

/** How the stub answers an identity challenge: as the real server would, as one exiting, or as a squatter might. */
export type StubBehavior =
  | 'prove'
  | 'exiting'
  | 'garbage'
  | 'replay'
  | 'stale'
  | 'other-endpoint'
  | 'other-version'
  | 'error';

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
  /** The version it claims to run. @default '1.0.0' */
  version?: string;
  /** How it answers a drain request: the status, and whether it then stops listening. @default 202, closing */
  drain?: { status: number; close: boolean };
  /** The status it answers any other request with. @default 204 */
  status?: number;
  /** Answer the first request other than a challenge or a drain as a server asked to exit right then, and stop. */
  exitOnRequest?: boolean;
}): Promise<IdentityStub> {
  const version = options.version ?? '1.0.0';
  const drain = options.drain ?? { status: 202, close: true };
  const { proofKey } = deriveSharedServerKeys(options.secret);
  const requests: StubRequest[] = [];
  const recordedNonce = createSharedServerNonce();

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
      if (req.url === SHARED_DRAIN_PATH) {
        res.statusCode = drain.status;
        res.end();
        if (drain.status === 202 && drain.close) setImmediate(() => void close());
        return;
      }
      if (req.url !== SHARED_IDENTIFY_PATH && options.exitOnRequest) {
        res.writeHead(503, { [SHARED_STATE_HEADER]: SHARED_EXITING });
        res.end();
        setImmediate(() => void close());
        return;
      }
      if (req.url !== SHARED_IDENTIFY_PATH) {
        res.statusCode = options.status ?? 204;
        res.end();
        return;
      }
      if (options.behavior === 'exiting') {
        res.writeHead(503, { [SHARED_STATE_HEADER]: SHARED_EXITING });
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
      res.end(JSON.stringify({ proof, version }));
    });
  });

  function proofFor(behavior: StubBehavior, endpointId: string, nonce: string): string | undefined {
    const statement = { endpoint: endpointId, nonce, version };
    switch (behavior) {
      case 'prove':
      case 'exiting':
        return proveSharedServerIdentity(proofKey, statement);
      case 'garbage':
        return base64urlEncode(randomBytes(32));
      case 'replay':
        return proveSharedServerIdentity(proofKey, { ...statement, nonce: recordedNonce });
      case 'stale':
        return proveSharedServerIdentity(deriveSharedServerKeys(base64urlEncode(randomBytes(32))).proofKey, statement);
      case 'other-endpoint':
        return proveSharedServerIdentity(proofKey, { ...statement, endpoint: `${endpointId}0` });
      case 'other-version':
        return proveSharedServerIdentity(proofKey, { ...statement, version: `${version}-other` });
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
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
    return closing;
  }
  return { endpoint, port, requests, close };
}
