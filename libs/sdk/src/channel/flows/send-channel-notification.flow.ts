// file: libs/sdk/src/channel/flows/send-channel-notification.flow.ts

import { z } from '@frontmcp/lazy-zod';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import { InvalidInputError } from '../../errors';
import type { ChannelNotificationService } from '../channel-notification.service';

const inputSchema = z.object({
  channelName: z.string().min(1),
  content: z.string().min(1),
  meta: z.record(z.string(), z.string()).optional(),
});

const outputSchema = z.object({
  sent: z.boolean(),
  channelName: z.string(),
});

const stateSchema = z.object({
  channelName: z.string(),
  content: z.string(),
  meta: z.record(z.string(), z.string()).optional(),
  output: outputSchema.optional(),
});

const plan = {
  pre: ['parseInput'],
  execute: ['send'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'channels:send-notification': FlowRunOptions<
      SendChannelNotificationFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'channels:send-notification' as const;
const { Stage } = FlowHooksOf<'channels:send-notification'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class SendChannelNotificationFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('SendChannelNotificationFlow');

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let data: z.infer<typeof inputSchema>;
    try {
      data = inputSchema.parse(this.rawInput);
    } catch (e) {
      throw new InvalidInputError('Invalid channel notification input', e instanceof z.ZodError ? e.issues : undefined);
    }

    this.state.set({
      channelName: data.channelName,
      content: data.content,
      meta: data.meta,
    });
    this.logger.verbose('parseInput:done');
  }

  @Stage('send')
  async send() {
    this.logger.verbose('send:start');

    const { channelName, content, meta } = this.state.required;
    const scope = this.scope as unknown as { channelNotifications?: ChannelNotificationService };
    const channelNotifications = scope.channelNotifications;

    if (!channelNotifications) {
      this.logger.warn('Channel notification service not available');
      this.state.set({ ...this.state.required, output: { sent: false, channelName } });
      return;
    }

    channelNotifications.send(channelName, content, meta);
    this.state.set({ ...this.state.required, output: { sent: true, channelName } });

    this.logger.verbose('send:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const output = this.state.required.output ?? { sent: false, channelName: this.state.required.channelName };
    this.respond(output);
    this.logger.verbose('finalize:done');
  }
}
