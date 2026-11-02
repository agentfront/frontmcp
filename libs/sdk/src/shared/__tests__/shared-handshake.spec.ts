import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { createSharedServerSecret, deriveSharedServerKeys, proveSharedServerIdentity } from '@frontmcp/auth';

import {
  startIdentityStub,
  type IdentityStub,
  type StubBehavior,
} from '../../__test-utils__/helpers/shared-server-stub';
import { httpEndpoint, identifySharedServer, SHARED_IDENTIFY_PATH, SHARED_STATE_HEADER } from '../shared-endpoint';

const verified = (version: string) => ({ outcome: 'verified', version });

describe('identifySharedServer', () => {
  const secret = createSharedServerSecret();
  const { proofKey, token } = deriveSharedServerKeys(secret);
  let stub: IdentityStub | undefined;

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
  });

  /** The stub saw challenges only: no credential, and nothing but the nonce. */
  function expectNoCredentialSent(seen: IdentityStub): void {
    expect(seen.requests.length).toBeGreaterThan(0);
    for (const request of seen.requests) {
      expect(request.path).toBe(SHARED_IDENTIFY_PATH);
      expect(request.headers['authorization']).toBeUndefined();
      expect(Object.keys(JSON.parse(request.body) as object)).toEqual(['nonce']);
      expect(JSON.stringify(request)).not.toContain(token);
      expect(JSON.stringify(request)).not.toContain(secret);
    }
  }

  it('verifies a server that proves it holds the key, over loopback HTTP', async () => {
    stub = await startIdentityStub({ secret, behavior: 'prove' });
    await expect(identifySharedServer(stub.endpoint, proofKey)).resolves.toEqual(verified('1.0.0'));
    expectNoCredentialSent(stub);
  });

  it('learns the version the server runs from its proof', async () => {
    stub = await startIdentityStub({ secret, behavior: 'prove', version: '2.3.0' });
    await expect(identifySharedServer(stub.endpoint, proofKey)).resolves.toEqual(verified('2.3.0'));
  });

  it.each([
    ['a version that is not a string', 42],
    ['a version longer than one', '1'.repeat(257)],
  ])('refuses an answer with %s', async (_, version) => {
    const nonceOf = (body: string): string => (JSON.parse(body) as { nonce: string }).nonce;
    const liar = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        const { port } = liar.address() as AddressInfo;
        const endpoint = `http://127.0.0.1:${port}`;
        const proof = proveSharedServerIdentity(proofKey, { endpoint, nonce: nonceOf(body), version: String(version) });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ proof, version }));
      });
    });
    await new Promise<void>((resolve) => liar.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = liar.address() as AddressInfo;
      await expect(identifySharedServer(httpEndpoint(port), proofKey)).resolves.toEqual({ outcome: 'refused' });
    } finally {
      await new Promise<void>((resolve) => liar.close(() => resolve()));
    }
  });

  it('sends a fresh nonce with every challenge', async () => {
    stub = await startIdentityStub({ secret, behavior: 'prove' });
    await identifySharedServer(stub.endpoint, proofKey);
    await identifySharedServer(stub.endpoint, proofKey);
    const nonces = stub.requests.map(({ body }) => (JSON.parse(body) as { nonce: string }).nonce);
    expect(new Set(nonces).size).toBe(2);
  });

  it.each<StubBehavior>(['garbage', 'replay', 'stale', 'other-endpoint', 'other-version', 'error'])(
    'refuses a squatter whose answer is %s',
    async (behavior) => {
      stub = await startIdentityStub({ secret, behavior });
      await expect(identifySharedServer(stub.endpoint, proofKey)).resolves.toEqual({ outcome: 'refused' });
      expectNoCredentialSent(stub);
    },
  );

  it.each([
    ['without a length', {}],
    ['longer than a proof', { 'content-length': String(64 * 1024 * 1024) }],
  ])(
    'refuses an answer %s without reading it, so a squatter can not fill the memory of a session',
    async (_, headers) => {
      const total = 64 * 1024 * 1024;
      const chunk = Buffer.alloc(1024 * 1024, 'a');
      let sent = 0;
      const flood = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json', ...headers });
        const pump = (): void => {
          while (sent < total) {
            sent += chunk.length;
            if (!res.write(chunk)) {
              res.once('drain', pump);
              return;
            }
          }
          res.end();
        };
        pump();
      });
      await new Promise<void>((resolve) => flood.listen(0, '127.0.0.1', resolve));
      try {
        const { port } = flood.address() as AddressInfo;
        await expect(identifySharedServer(httpEndpoint(port), proofKey)).resolves.toEqual({ outcome: 'refused' });
        expect(sent).toBeLessThan(total);
      } finally {
        flood.closeAllConnections();
        await new Promise<void>((resolve) => flood.close(() => resolve()));
      }
    },
  );

  it.each([
    ['exiting, once it says so', { [SHARED_STATE_HEADER]: 'exiting' }, 'exiting'],
    ['refused, when an unavailable answer does not say it is exiting', {}, 'refused'],
  ])('reports a server that answers 503 as %s', async (_, headers, outcome) => {
    const unavailable = http.createServer((req, res) => {
      res.writeHead(503, headers);
      res.end();
    });
    await new Promise<void>((resolve) => unavailable.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = unavailable.address() as AddressInfo;
      await expect(identifySharedServer(httpEndpoint(port), proofKey)).resolves.toEqual({ outcome });
    } finally {
      await new Promise<void>((resolve) => unavailable.close(() => resolve()));
    }
  });

  it('reports an endpoint nothing listens on as unreachable', async () => {
    stub = await startIdentityStub({ secret, behavior: 'prove' });
    const { port } = stub;
    await stub.close();
    stub = undefined;
    await expect(identifySharedServer(httpEndpoint(port as number), proofKey)).resolves.toEqual({
      outcome: 'unreachable',
    });
  });

  const posixOnly = process.platform === 'win32' ? it.skip : it;

  posixOnly('verifies a server on a Unix socket, bound to its socket path', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-sock-'));
    try {
      stub = await startIdentityStub({ secret, behavior: 'prove', socketPath: path.join(directory, 'server.sock') });
      expect(stub.endpoint.id).toBe(`unix:${path.join(directory, 'server.sock')}`);
      await expect(identifySharedServer(stub.endpoint, proofKey)).resolves.toEqual(verified('1.0.0'));
      const { endpoint } = stub;
      await stub.close();
      stub = undefined;
      await expect(identifySharedServer(endpoint, proofKey)).resolves.toEqual({ outcome: 'unreachable' });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
