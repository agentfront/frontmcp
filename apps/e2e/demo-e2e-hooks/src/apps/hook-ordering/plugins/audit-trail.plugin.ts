import { HookPhase, Plugin, ToolHook } from '@frontmcp/sdk';

import { runLog } from '../data/run-log';

/** Installed on one app, it audits the tools of every app. */
@Plugin({ name: 'audit-trail', description: 'Records that the audit trail ran' })
export default class AuditTrailPlugin {
  @ToolHook.Will('execute', { priority: HookPhase.observe, appliesTo: 'all-apps' })
  audit() {
    runLog.record('audit-trail');
  }
}
