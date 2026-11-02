import { Plugin, ToolHook } from '@frontmcp/sdk';

import { gateLog } from '../data/gate-log';

/** Listed first, but its priority is the higher, so it runs after the feature gate. */
@Plugin({ name: 'setup-gate', description: 'Records that the setup gate ran' })
export default class SetupGatePlugin {
  @ToolHook.Will('execute', { priority: 10 })
  requireSetup() {
    gateLog.record('setup-gate');
  }
}
