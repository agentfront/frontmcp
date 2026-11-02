import { App } from '@frontmcp/sdk';

import AuditTrailPlugin from './plugins/audit-trail.plugin';
import QuotaGatePlugin from './plugins/quota-gate.plugin';
import TenantResolverPlugin from './plugins/tenant-resolver.plugin';
import { ranHooksTool } from './tools/ran-hooks.tool';

@App({
  id: 'ordered',
  name: 'ordered',
  plugins: [QuotaGatePlugin, TenantResolverPlugin, AuditTrailPlugin],
  tools: [ranHooksTool('ordered-run')],
})
export class OrderedApp {}

/** No plugin of its own: only the other app's 'all-apps' hook runs for its tool. */
@App({ id: 'second', name: 'second', tools: [ranHooksTool('second-run')] })
export class SecondApp {}
