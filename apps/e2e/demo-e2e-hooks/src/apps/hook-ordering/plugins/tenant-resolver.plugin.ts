import { HookPhase, Plugin, ToolHook } from '@frontmcp/sdk';

import { runLog } from '../data/run-log';

/** The quota gate reads the tenant, so this runs before it whatever their priorities. */
@Plugin({ name: 'tenant-resolver', description: 'Records that the tenant resolver ran' })
export default class TenantResolverPlugin {
  @ToolHook.Will('execute', { priority: HookPhase.guard + 50, before: ['quota-gate'] })
  resolveTenant() {
    runLog.record('tenant-resolver');
  }
}
