/**
 * `@App({ auth })` on the shared endpoint (#766). Only a local or remote server
 * enforces an app's own auth there, so a public server refuses to start with a
 * protected app on it rather than serve that app's tools without its auth.
 */
import 'reflect-metadata';

import { App, Tool, ToolContext } from '../../common';
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
