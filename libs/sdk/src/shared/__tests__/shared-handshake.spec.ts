import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createSharedServerSecret, deriveSharedServerKeys } from '@frontmcp/auth';

import {
  startIdentityStub,
  type IdentityStub,
  type StubBehavior,
} from '../../__test-utils__/helpers/shared-server-stub';
import { httpEndpoint, identifySharedServer, SHARED_IDENTIFY_PATH } from '../shared-endpoint';

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
    await expect(identifySharedServer(stub.endpoint, proofKey)).resolves.toBe('verified');
    expectNoCredentialSent(stub);
  });

  it('sends a fresh nonce with every challenge', async () => {
    stub = await startIdentityStub({ secret, behavior: 'prove' });
    await identifySharedServer(stub.endpoint, proofKey);
    await identifySharedServer(stub.endpoint, proofKey);
    const nonces = stub.requests.map(({ body }) => (JSON.parse(body) as { nonce: string }).nonce);
    expect(new Set(nonces).size).toBe(2);
  });

  it.each<StubBehavior>(['garbage', 'replay', 'stale', 'other-endpoint', 'error'])(
    'refuses a squatter whose answer is %s',
    async (behavior) => {
      stub = await startIdentityStub({ secret, behavior });
      await expect(identifySharedServer(stub.endpoint, proofKey)).resolves.toBe('refused');
      expectNoCredentialSent(stub);
    },
  );

  it('reports an endpoint nothing listens on as unreachable', async () => {
    stub = await startIdentityStub({ secret, behavior: 'prove' });
    const { port } = stub;
    await stub.close();
    stub = undefined;
    await expect(identifySharedServer(httpEndpoint(port as number), proofKey)).resolves.toBe('unreachable');
  });

  const posixOnly = process.platform === 'win32' ? it.skip : it;

  posixOnly('verifies a server on a Unix socket, bound to its socket path', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-sock-'));
    try {
      stub = await startIdentityStub({ secret, behavior: 'prove', socketPath: path.join(directory, 'server.sock') });
      expect(stub.endpoint.id).toBe(`unix:${path.join(directory, 'server.sock')}`);
      await expect(identifySharedServer(stub.endpoint, proofKey)).resolves.toBe('verified');
      const { endpoint } = stub;
      await stub.close();
      stub = undefined;
      await expect(identifySharedServer(endpoint, proofKey)).resolves.toBe('unreachable');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
