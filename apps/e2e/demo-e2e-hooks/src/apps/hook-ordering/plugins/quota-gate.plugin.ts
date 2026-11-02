import { HookPhase, Plugin, ToolHook } from '@frontmcp/sdk';

import { runLog } from '../data/run-log';

/** A guard with the lower priority: without a constraint it would run before the tenant resolver. */
@Plugin({ name: 'quota-gate', description: 'Records that the quota gate ran' })
export default class QuotaGatePlugin {
  @ToolHook.Will('execute', { priority: HookPhase.guard })
  checkQuota() {
    runLog.record('quota-gate');
  }
}
