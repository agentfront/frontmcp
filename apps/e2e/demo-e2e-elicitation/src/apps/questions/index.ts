import { z } from '@frontmcp/lazy-zod';
import { App, printQuestionInboxLink, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'approve-deploy',
  description: 'Asks the person to approve a deploy; the question outlives the session that asked it.',
  inputSchema: {
    version: z.string().describe('The version to deploy'),
    waitMs: z.number().int().positive().optional().describe('How long this call waits for the answer'),
  },
})
class ApproveDeployTool extends ToolContext {
  async execute(input: { version: string; waitMs?: number }) {
    const answer = await this.elicit(
      `Deploy ${input.version} to production?`,
      z.object({ approve: z.boolean().describe('Approve the deploy') }),
      { ttl: input.waitMs ?? 60_000, persist: { key: `deploy-${input.version}` } },
    );
    const approved = answer.status === 'accept' && answer.content?.approve === true;
    return { text: approved ? `Deploy ${input.version} approved` : `Deploy ${input.version} not approved` };
  }
}

@Tool({
  name: 'inbox-link',
  description: 'Prints a one-time sign-in link to the inbox of the caller on the server console, for the person.',
  inputSchema: {},
})
class InboxLinkTool extends ToolContext {
  async execute() {
    return printQuestionInboxLink(this);
  }
}

@App({ name: 'Questions', tools: [ApproveDeployTool, InboxLinkTool] })
export class QuestionsApp {}
