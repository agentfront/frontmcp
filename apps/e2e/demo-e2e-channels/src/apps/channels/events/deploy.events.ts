import { z } from '@frontmcp/lazy-zod';
import { Event, event, EventContext } from '@frontmcp/sdk';

const deployPayload = { version: z.string(), status: z.string(), env: z.string() };

/** Sent to Claude Code sessions as its payload in JSON. */
@Event({
  name: 'deploy.started',
  description: 'A deploy started',
  payloadSchema: deployPayload,
  channel: true,
})
export class DeployStarted extends EventContext {}

/** Sent to Claude Code sessions as a sentence, with the environment and the version as attributes. */
export const deployFinished = event({
  name: 'deploy.finished',
  description: 'A deploy finished',
  payloadSchema: deployPayload,
  channel: {
    content: (payload) => `Deploy ${payload.status}: ${payload.version}`,
    meta: (payload) => ({ env: payload.env, 'deploy-version': payload.version }),
  },
});
