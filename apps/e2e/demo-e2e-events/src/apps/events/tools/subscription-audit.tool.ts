import { Tool, ToolContext } from '@frontmcp/sdk';

import { auditedEnds } from '../plugins/subscription-audit.plugin';

@Tool({
  name: 'subscription-audit',
  description:
    'Answers the webhook subscription ends the subscription-audit plugin heard of, and the subscriptions the server lists',
  inputSchema: {},
})
export default class SubscriptionAuditTool extends ToolContext {
  async execute() {
    return { ended: auditedEnds, subscriptions: (await this.scope.events?.listSubscriptions()) ?? [] };
  }
}
