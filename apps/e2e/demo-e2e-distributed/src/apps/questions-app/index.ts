import { z } from '@frontmcp/lazy-zod';
import { App, printQuestionInboxLink, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'approve-deploy',
  description: 'Asks the person to approve a deploy; the question outlives the call that asked it.',
  inputSchema: { version: z.string() },
})
class ApproveDeployTool extends ToolContext {
  async execute(input: { version: string }) {
    const answer = await this.elicit(`Deploy ${input.version} to production?`, z.object({ approve: z.boolean() }), {
      ttl: 60_000,
      persist: { key: `deploy-${input.version}` },
    });
    const approved = answer.status === 'accept' && answer.content?.approve === true;
    return { text: approved ? `Deploy ${input.version} approved` : `Deploy ${input.version} not approved` };
  }
}

@Tool({
  name: 'inbox-link',
  description: "Prints a one-time sign-in link to the caller's question inbox on the server console.",
  inputSchema: {},
})
class InboxLinkTool extends ToolContext {
  async execute() {
    return printQuestionInboxLink(this);
  }
}

@App({ name: 'questions', tools: [ApproveDeployTool, InboxLinkTool] })
export class QuestionsApp {}
