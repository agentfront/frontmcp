import { ApprovalCheckPlugin, ApprovalPlugin } from '@frontmcp/plugin-approval';
import { App } from '@frontmcp/sdk';

import { opsTools } from './tools';

/** The setup from the GHSA-r848-p7wf-96rc report, which also lists the check plugin itself. */
@App({
  id: 'ops',
  name: 'Ops',
  plugins: [ApprovalPlugin.init({ storage: { type: 'memory' } }), ApprovalCheckPlugin],
  tools: opsTools,
})
export class OpsWithExplicitCheckApp {}
