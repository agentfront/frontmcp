import { ApprovalPlugin } from '@frontmcp/plugin-approval';
import { App } from '@frontmcp/sdk';

import { opsTools } from './tools';

/** The documented setup: `ApprovalPlugin.init()` alone. */
@App({ id: 'ops', name: 'Ops', plugins: [ApprovalPlugin.init({ storage: { type: 'memory' } })], tools: opsTools })
export class OpsApp {}
