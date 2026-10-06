/**
 * `@App({ auth })` on the shared endpoint (#766). Only a local or remote server
 * enforces an app's own auth there, so a public server refuses to start with a
 * protected app on it rather than serve that app's tools without its auth.
 */
import 'reflect-metadata';

import { App, Tool, ToolContext } from '../../common';
import { AuthConfigurationError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

@Tool({ name: 'list_invoices', description: 'Lists invoices', inputSchema: {} })
class ListInvoicesTool extends ToolContext {
  async execute() {
    return 'invoices';
  }
}

const remoteAuth = { mode: 'remote', provider: 'https://idp.example.com', clientId: 'billing' } as const;

describe('@App({ auth }) on the shared endpoint', () => {
  it('refuses to start a public server with a protected app on its shared endpoint', async () => {
    @App({ name: 'billing', auth: remoteAuth, tools: [ListInvoicesTool] })
    class BillingApp {}

    await expect(
      FrontMcpInstance.createDirect({ info: { name: 'gw', version: '1.0.0' }, apps: [BillingApp] }),
    ).rejects.toThrow('App-level auth is not enforced on the shared endpoint of a server in public mode');
  });

  it('starts with an app that declares public auth on the shared endpoint', async () => {
    @App({ name: 'billing', auth: { mode: 'public' }, tools: [ListInvoicesTool] })
    class PublicBillingApp {}

    const server = await FrontMcpInstance.createDirect({
      info: { name: 'gw', version: '1.0.0' },
      apps: [PublicBillingApp],
    });
    await server.dispose();
  });
});

describe("App.remote({ remoteAuth: { mode: 'forward' } })", () => {
  it('refuses to start a server that would forward a token it minted itself (#766)', async () => {
    await expect(
      FrontMcpInstance.createDirect({
        info: { name: 'gw', version: '1.0.0' },
        apps: [App.remote('http://127.0.0.1:9/mcp', { name: 'upstream', remoteAuth: { mode: 'forward' } })],
      }),
    ).rejects.toThrow("remoteAuth: { mode: 'forward' } on upstream would send the remote a token");
  });
});

describe('the suggestion on a refused auth configuration', () => {
  async function suggestionFor(config: Parameters<typeof FrontMcpInstance.createDirect>[0]): Promise<string> {
    const error = await FrontMcpInstance.createDirect(config).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(AuthConfigurationError);
    return (error as AuthConfigurationError).suggestion ?? '';
  }

  it('points a forwarding remote app at static credentials or a transparent server', async () => {
    const suggestion = await suggestionFor({
      info: { name: 'gw', version: '1.0.0' },
      auth: { mode: 'local' },
      apps: [App.remote('http://127.0.0.1:9/mcp', { name: 'upstream', remoteAuth: { mode: 'forward' } })],
    });

    expect(suggestion).toContain("remoteAuth: { mode: 'static'");
    expect(suggestion).toContain('transparent');
    expect(suggestion).not.toContain("to 'local' or 'remote'");
  });

  it('points a protected app on an unenforced shared endpoint at its own endpoint', async () => {
    @App({ name: 'billing', auth: remoteAuth, tools: [ListInvoicesTool] })
    class BillingApp {}

    const suggestion = await suggestionFor({ info: { name: 'gw', version: '1.0.0' }, apps: [BillingApp] });

    expect(suggestion).toContain('splitByApp: true');
    expect(suggestion).toContain('incrementalAuth');
  });
});
