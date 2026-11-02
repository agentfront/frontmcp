import { Plugin, ToolHook } from '@frontmcp/sdk';

import { gateLog } from '../data/gate-log';

/** Meant to refuse a disabled feature before any other gate, so it has the lower priority. */
@Plugin({ name: 'feature-gate', description: 'Records that the feature gate ran' })
export default class FeatureGatePlugin {
  @ToolHook.Will('execute', { priority: -10 })
  refuseDisabled() {
    gateLog.record('feature-gate');
  }
}
