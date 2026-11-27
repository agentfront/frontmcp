import { EventEndedHook, Plugin, type FlowCtxOf } from '@frontmcp/sdk';

/** One end of a webhook subscription, as the plugin heard of it. */
export interface AuditedEnd {
  id: string;
  eventName: string;
  reason: string;
}

/** The ends the plugin heard of, oldest first; the `subscription-audit` tool reads them. */
export const auditedEnds: AuditedEnd[] = [];

/** Keeps a view of the subscriptions that ended, however they ended, as a settings page or an audit log would. */
@Plugin({ name: 'subscription-audit', description: 'Records every end of a webhook subscription' })
export class SubscriptionAuditPlugin {
  @EventEndedHook.Did('notifyEnded')
  recordEnd(ctx: FlowCtxOf<'events:ended'>) {
    const { record, reason } = ctx.state.required;
    auditedEnds.push({ id: record.id, eventName: record.eventName, reason });
  }
}
