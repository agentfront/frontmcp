import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  event: z.enum(['deploy.started', 'deploy.finished']).describe('The deploy event to publish'),
  version: z.string().describe('The version that is deployed'),
  status: z.string().describe('The state of the deploy, such as "succeeded"'),
  env: z.string().describe('The environment it is deployed to'),
};

type PublishDeployEventInput = z.infer<z.ZodObject<typeof inputSchema>>;

/** Publishes one of the demo's deploy events, both of which have the `channel` option. */
@Tool({
  name: 'publish-deploy-event',
  description: 'Publish a deploy event, which its channel option also sends to Claude Code sessions',
  inputSchema,
})
export default class PublishDeployEventTool extends ToolContext {
  /** Publishes one occurrence of the named event and answers its id. */
  async execute(input: PublishDeployEventInput) {
    const { event: eventName, ...payload } = input;
    const { eventId } = await this.events.publish(eventName, payload);
    return { published: eventName, eventId };
  }
}
