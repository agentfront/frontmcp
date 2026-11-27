import { Tool, ToolContext } from '@frontmcp/sdk';

import { auditedEnds } from '../plugins/subscription-audit.plugin';

@Tool({
  name: 'subscription-audit',
  description: 'Answers the webhook subscription ends the subscription-audit plugin heard of',
  inputSchema: {},
})
export default class SubscriptionAuditTool extends ToolContext {
  async execute() {
    return { ended: auditedEnds };
  }
}
