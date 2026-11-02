/**
 * The OAuth flows are registered by name and route, and each one's class loads with the first request that reaches it
 * (#950). A public-mode server still runs a plugin's hooks on every one of them.
 */
import 'reflect-metadata';

import { FlowHooksOf, LogLevel, Plugin, type FlowType } from '../../../common';
import { deferredFlowLoader } from '../../../flows/deferred-flow';
import { collectFlowMetadata } from '../../../flows/flow.utils';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { oauthFlows } from '../oauth-flows';

const ROUTES = [
  ['oauth:authorize', 'GET', '/oauth/authorize'],
  ['oauth:token', 'POST', '/oauth/token'],
  ['oauth:userinfo', 'GET', '/oauth/userinfo'],
  ['oauth:callback', 'GET', '/oauth/callback'],
  ['oauth:connect', 'POST', '/oauth/connect'],
  ['oauth:register', 'POST', '/oauth/register'],
  ['oauth:provider-callback', 'GET', '/oauth/provider/upstream/callback'],
  ['oauth:auth-ui-extra', 'POST', '/oauth/ui/extra'],
] as const;

const hooked: string[] = [];

function loadFlowClass(flow: FlowType): Promise<FlowType> {
  const load = deferredFlowLoader(flow);
  if (!load) throw new Error(`${flow.name} is not a deferred flow`);
  return load();
}

class OAuthHooksPlugin {}
for (const [flow] of ROUTES) {
  const method = `will:${flow}`;
  const descriptor: PropertyDescriptor = { value: () => hooked.push(flow) };
  Object.defineProperty(OAuthHooksPlugin.prototype, method, descriptor);
  FlowHooksOf(flow).Will('checkIpFilter')(OAuthHooksPlugin.prototype, method, descriptor);
}
Plugin({ name: 'oauth-hooks' })(OAuthHooksPlugin);

describe('oauthFlows', () => {
  it('declares each flow by the name and route of the class it loads', async () => {
    const declared = oauthFlows.map((flow) => collectFlowMetadata(flow));
    const loaded = await Promise.all(oauthFlows.map(async (flow) => collectFlowMetadata(await loadFlowClass(flow))));

    expect(declared.map(({ name, middleware }) => ({ name, middleware }))).toEqual(
      loaded.map(({ name, middleware }) => ({
        name,
        middleware: { method: middleware?.method, path: middleware?.path },
      })),
    );
    expect(declared.map(({ name }) => name)).toEqual(ROUTES.map(([flow]) => flow));
  });

  it('runs the hooks of every OAuth flow of a public-mode server', async () => {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'oauth-flows', version: '1.0.0' },
      apps: [],
      plugins: [OAuthHooksPlugin],
      logging: { level: LogLevel.Off },
    });

    for (const [, method, path] of ROUTES) {
      await (await handler(new Request(`http://localhost${path}`, { method }))).arrayBuffer();
    }

    expect(hooked).toEqual(ROUTES.map(([flow]) => flow));
  });
});
