import { App } from '@frontmcp/sdk';

import FeatureGatePlugin from './plugins/feature-gate.plugin';
import SetupGatePlugin from './plugins/setup-gate.plugin';
import GateOrderTool from './tools/gate-order.tool';

@App({
  id: 'hook-order',
  name: 'hook-order',
  plugins: [SetupGatePlugin, FeatureGatePlugin],
  tools: [GateOrderTool],
})
export class HookOrderApp {}
