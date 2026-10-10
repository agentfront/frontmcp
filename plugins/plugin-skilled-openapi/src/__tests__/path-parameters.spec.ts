import { MemoryCredentialResolver } from '../executor/credential-resolver';
import { executeOperation, type OpenApiRuntimeDeps } from '../executor/openapi-runtime';
import type { HiddenOpEntry } from '../registry/hidden-op.registry';

const logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

const refundInvoice: HiddenOpEntry = {
  skillId: 'billing',
  bundleId: 'test:bundle',
  bundleVersion: 'v1',
  service: { id: 'svc', baseUrl: 'http://localhost:9999/v1' },
  authBinding: { kind: 'bearer', vaultRef: 'billing-token' },
  op: {
    operationId: 'refundInvoice',
    serviceId: 'svc',
    httpMethod: 'POST',
    pathTemplate: '/invoices/{id}/refunds',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    outputSchema: { type: 'object' },
    mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
    authBindingRef: 'def',
  },
};

function runRefund(id: string) {
  const sentUrls: string[] = [];
  const deps: OpenApiRuntimeDeps = {
    outbound: {
      allowPrivateNetworks: true,
      maxConcurrencyPerHost: 10,
      defaultTimeoutMs: 5_000,
      defaultMaxResponseBytes: 256 * 1024,
      allowHttp: true,
    },
    resolver: new MemoryCredentialResolver({ 'billing-token': 'sk_live_x' }),
    allowedHosts: new Set(['localhost']),
    logger,
    fetchImpl: (async (input: string | URL) => {
      sentUrls.push(String(input));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  };
  return executeOperation({ entry: refundInvoice, bundleId: 'acme', input: { id }, deps }).then((result) => ({
    result,
    sentUrls,
  }));
}

describe('a skilled-OpenAPI operation with a dot-segment path parameter', () => {
  it.each(['..', '.'])('sends nothing for an id of %j', async (id) => {
    const { result, sentUrls } = await runRefund(id);

    expect(sentUrls).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "request build failed: Path parameter 'id' of operation 'refundInvoice' cannot be '.' or '..'",
    );
  });

  it.each([
    ['..%2Fadmin', 'http://localhost:9999/v1/invoices/..%252Fadmin/refunds'],
    ['%2e%2e', 'http://localhost:9999/v1/invoices/%252e%252e/refunds'],
    [' .. ', 'http://localhost:9999/v1/invoices/%20..%20/refunds'],
    ['INV-1', 'http://localhost:9999/v1/invoices/INV-1/refunds'],
  ])('sends %j encoded, as before', async (id, url) => {
    const { result, sentUrls } = await runRefund(id);

    expect(result.ok).toBe(true);
    expect(sentUrls).toEqual([url]);
  });
});
