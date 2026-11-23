/**
 * RemotePrimaryAuth — the startup warning of a transparent server whose token audience is not configured.
 *
 * Without `expectedAudience`, `FRONTMCP_PUBLIC_URL` or allowed hosts, a token's audience is checked against the
 * host each request names. 1.12.x keeps that and warns once at startup; 1.13 refuses such tokens.
 */
import 'reflect-metadata';

import { RemotePrimaryAuth } from '../instance.remote-primary-auth';

function startServer(options: { expectedAudience?: string; allowedHosts?: string[]; protectionOff?: boolean } = {}) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn() };
  const dnsRebindingProtection = {
    ...(options.allowedHosts && { allowedHosts: options.allowedHosts }),
    ...(options.protectionOff && { enabled: false }),
  };
  const scope = {
    logger,
    metadata: { http: { security: { dnsRebindingProtection } } },
    registryFlows: jest.fn().mockResolvedValue(undefined),
  };
  const providers = { getActiveScope: () => scope, injectProvider: jest.fn() };
  const auth = new RemotePrimaryAuth(
    scope as never,
    providers as never,
    {
      mode: 'transparent',
      provider: 'https://idp.example.com',
      ...(options.expectedAudience !== undefined && { expectedAudience: options.expectedAudience }),
    } as never,
  );
  return { auth, warn: logger.warn };
}

describe('RemotePrimaryAuth — warning for a token audience that is not configured', () => {
  afterEach(() => {
    delete process.env['FRONTMCP_PUBLIC_URL'];
    delete process.env['FRONTMCP_ALLOWED_HOSTS'];
  });

  it('warns once at startup, naming the setting to add and what 1.13 will refuse', async () => {
    const { auth, warn } = startServer();
    await auth.ready;

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('auth.expectedAudience');
    expect(warn.mock.calls[0][0]).toContain('FrontMCP 1.13 will refuse tokens that carry an aud claim');
  });

  it('does not warn with auth.expectedAudience', async () => {
    const { auth, warn } = startServer({ expectedAudience: 'https://mcp.example.com' });
    await auth.ready;

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn with FRONTMCP_PUBLIC_URL', async () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://mcp.example.com';
    const { auth, warn } = startServer();
    await auth.ready;

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn with security.dnsRebindingProtection.allowedHosts', async () => {
    const { auth, warn } = startServer({ allowedHosts: ['mcp.example.com'] });
    await auth.ready;

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when hosts are listed but DNS-rebinding protection is off', async () => {
    process.env['FRONTMCP_ALLOWED_HOSTS'] = 'mcp.example.com';
    const { auth, warn } = startServer({ allowedHosts: ['mcp.example.com'], protectionOff: true });
    await auth.ready;

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('starts, and warns, where there is no process (a browser or a Worker)', async () => {
    const runtime = globalThis as { process?: unknown };
    const nodeProcess = runtime.process;
    const { auth, warn } = startServer();
    runtime.process = undefined;
    try {
      await auth.ready;
    } finally {
      runtime.process = nodeProcess;
    }

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns with FRONTMCP_ALLOWED_HOSTS alone, which the Web fetch handler does not check', async () => {
    process.env['FRONTMCP_ALLOWED_HOSTS'] = 'mcp.example.com';
    const { auth, warn } = startServer();
    await auth.ready;

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
