/**
 * RemotePrimaryAuth — the startup warning of a transparent server whose token audience is not configured.
 *
 * Without `expectedAudience`, `FRONTMCP_PUBLIC_URL` or allowed hosts, a token's audience is checked against the
 * host each request names. 1.12.x keeps that and warns once at startup; 1.13 refuses such tokens.
 */
import 'reflect-metadata';

import { RemotePrimaryAuth } from '../instance.remote-primary-auth';

function startServer(
  options: {
    expectedAudience?: string;
    allowedHosts?: string[];
    protectionOff?: boolean;
    audienceFromRequestHost?: boolean;
  } = {},
) {
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
      ...(options.audienceFromRequestHost !== undefined && {
        audienceFromRequestHost: options.audienceFromRequestHost,
      }),
    } as never,
  );
  return { auth, warn: logger.warn };
}

describe('RemotePrimaryAuth — warning for a token audience that is not configured', () => {
  const originalEnv = {
    FRONTMCP_PUBLIC_URL: process.env['FRONTMCP_PUBLIC_URL'],
    FRONTMCP_ALLOWED_HOSTS: process.env['FRONTMCP_ALLOWED_HOSTS'],
  };

  beforeEach(() => {
    delete process.env['FRONTMCP_PUBLIC_URL'];
    delete process.env['FRONTMCP_ALLOWED_HOSTS'];
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it.each([
    ['test', "accepted only for this server's loopback address (NODE_ENV is development or test)"],
    ['development', "accepted only for this server's loopback address (NODE_ENV is development or test)"],
    ['production', 'refused (NODE_ENV is not development or test)'],
    [undefined, 'refused (NODE_ENV is not development or test)'],
  ])('warns once at startup with NODE_ENV %s that tokens with an aud are %s', async (nodeEnv, accepted) => {
    const original = process.env['NODE_ENV'];
    if (nodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = nodeEnv;
    try {
      const { auth, warn } = startServer();
      await auth.ready;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(`tokens that carry an aud claim are ${accepted}`);
      expect(warn.mock.calls[0][0]).toContain('auth.expectedAudience');
    } finally {
      process.env['NODE_ENV'] = original;
    }
  });

  it('warns once at startup that the request host decides the audience with audienceFromRequestHost', async () => {
    const { auth, warn } = startServer({ audienceFromRequestHost: true });
    await auth.ready;

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('host the request names, which the client chooses');
    expect(warn.mock.calls[0][0]).toContain('auth.expectedAudience');
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

  it('does not warn with FRONTMCP_ALLOWED_HOSTS', async () => {
    process.env['FRONTMCP_ALLOWED_HOSTS'] = 'mcp.example.com';
    const { auth, warn } = startServer();
    await auth.ready;

    expect(warn).not.toHaveBeenCalled();
  });
});
