import { resolveTxt } from 'dns/promises';

import { RegistryError } from '../errors';
import { formatProofRecord } from '../keys';
import { checkDnsProof, checkHttpProof } from '../proof';

jest.mock('dns/promises', () => ({ resolveTxt: jest.fn() }));

const PUBLIC_KEY = '11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=';
const OTHER_KEY = 'O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=';
const PROOF_URL = 'https://acme.com/.well-known/mcp-registry-auth';

describe('checkHttpProof', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('accepts the record for the private key, fetched without following redirects', async () => {
    fetchMock.mockResolvedValue(new Response(`\n${formatProofRecord(PUBLIC_KEY)}\n`));
    await expect(checkHttpProof('acme.com', PUBLIC_KEY)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(PROOF_URL, expect.objectContaining({ redirect: 'manual' }));
  });

  it('reports a redirect with its target', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 301, headers: { location: 'https://www.acme.com/.well-known/mcp-registry-auth' } }),
    );
    await expect(checkHttpProof('acme.com', PUBLIC_KEY)).resolves.toBe(
      `${PROOF_URL} redirects (301) to https://www.acme.com/.well-known/mcp-registry-auth. ` +
        'The Registry does not follow redirects: serve the record at this exact URL.',
    );
  });

  it('reports a non-200 answer and the variable to set', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(checkHttpProof('acme.com', PUBLIC_KEY)).resolves.toBe(
      `${PROOF_URL} answered 404; the Registry needs 200 with the record. ` +
        `Set MCP_REGISTRY_PUBLIC_KEY=${PUBLIC_KEY} on the server and redeploy.`,
    );
  });

  it('reports a body without a record', async () => {
    fetchMock.mockResolvedValue(new Response('<html>hello</html>'));
    await expect(checkHttpProof('acme.com', PUBLIC_KEY)).resolves.toBe(
      `${PROOF_URL} has no "v=MCPv1; k=ed25519; p=<public key>" record.`,
    );
  });

  it('reports a different key, naming both', async () => {
    fetchMock.mockResolvedValue(new Response(formatProofRecord(OTHER_KEY)));
    const problem = await checkHttpProof('acme.com', PUBLIC_KEY);
    expect(problem).toContain(`publishes the key ${OTHER_KEY}`);
    expect(problem).toContain(`the private key's public key is ${PUBLIC_KEY}`);
  });

  it('reports a key of another algorithm', async () => {
    fetchMock.mockResolvedValue(new Response(`v=MCPv1; k=ecdsap384; p=${OTHER_KEY}`));
    await expect(checkHttpProof('acme.com', PUBLIC_KEY)).resolves.toContain('publishes a ecdsap384 key');
  });

  it('reports a body larger than the Registry reads', async () => {
    fetchMock.mockResolvedValue(new Response(`${formatProofRecord(PUBLIC_KEY)}${' '.repeat(5000)}x`));
    await expect(checkHttpProof('acme.com', PUBLIC_KEY)).resolves.toContain('larger than 4096 bytes');
  });

  it('turns a network failure into a RegistryError', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND acme.com') }));
    await expect(checkHttpProof('acme.com', PUBLIC_KEY)).rejects.toThrow(
      new RegistryError(`GET ${PROOF_URL} failed: fetch failed (getaddrinfo ENOTFOUND acme.com)`),
    );
  });
});

describe('checkDnsProof', () => {
  const resolveTxtMock = resolveTxt as jest.MockedFunction<typeof resolveTxt>;

  it('finds the record among the TXT records, joining split chunks', async () => {
    const record = formatProofRecord(PUBLIC_KEY);
    resolveTxtMock.mockResolvedValue([['google-site-verification=abc'], [record.slice(0, 20), record.slice(20)]]);
    await expect(checkDnsProof('acme.com', PUBLIC_KEY)).resolves.toBeUndefined();
    expect(resolveTxtMock).toHaveBeenCalledWith('acme.com');
  });

  it('reports a missing record, a different key, and a failed lookup', async () => {
    resolveTxtMock.mockResolvedValue([['v=spf1 -all']]);
    await expect(checkDnsProof('acme.com', PUBLIC_KEY)).resolves.toContain('has no "v=MCPv1');

    resolveTxtMock.mockResolvedValue([[formatProofRecord(OTHER_KEY)]]);
    await expect(checkDnsProof('acme.com', PUBLIC_KEY)).resolves.toContain(`publishes the key ${OTHER_KEY}`);

    resolveTxtMock.mockRejectedValue(Object.assign(new Error('queryTxt ENODATA acme.com'), { code: 'ENODATA' }));
    await expect(checkDnsProof('acme.com', PUBLIC_KEY)).resolves.toBe(
      'could not read the TXT records of acme.com (ENODATA).',
    );
  });
});
