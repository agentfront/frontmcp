/**
 * The debug request log redacts the header that `auth.mode: 'static'` reads its shared credential
 * from, whatever that header is named; the name patterns alone miss a header like `x-mcp-access`.
 */
import 'reflect-metadata';

import HttpRequestFlow from '../http.request.flow';

const SHARED_CREDENTIAL = 'shared-credential-0001';

/** Run `traceRequest` for a request with `headers` on a scope with the given auth options; returns the debug log calls. */
async function traceHeaders(authOptions: unknown, headers: Record<string, string>): Promise<string> {
  const stage = Object.create(HttpRequestFlow.prototype) as HttpRequestFlow & Record<string, unknown>;
  const logger = { info: jest.fn(), debug: jest.fn() };
  Object.assign(stage, {
    scope: { auth: { options: authOptions } },
    logger,
    rawInput: { request: { method: 'POST', path: '/', headers } },
    tryGetContext: () => undefined,
  });
  await (stage as unknown as { traceRequest: () => Promise<void> }).traceRequest();
  return JSON.stringify(logger.debug.mock.calls);
}

describe('http:request traceRequest', () => {
  it('redacts the static-auth credential header, whatever its name', async () => {
    const logged = await traceHeaders(
      { mode: 'static', tokens: [SHARED_CREDENTIAL], header: 'X-MCP-Access', scheme: '' },
      { 'x-mcp-access': SHARED_CREDENTIAL, 'x-request-note': 'visible-header-value' },
    );

    expect(logged).not.toContain(SHARED_CREDENTIAL);
    expect(logged).toContain('[REDACTED]');
    expect(logged).toContain('visible-header-value');
  });

  it('keeps a header of that name in another auth mode', async () => {
    const logged = await traceHeaders({ mode: 'public' }, { 'x-mcp-access': 'visible-header-value' });

    expect(logged).toContain('visible-header-value');
  });
});
