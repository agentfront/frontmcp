// file: libs/sdk/src/channel/flows/send-channel-notification.flow.ts

import { z } from '@frontmcp/lazy-zod';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import { InvalidInputError } from '../../errors';
import type { ChannelNotificationMeta } from '../channel-notification.service';
import type { ChannelInstance } from '../channel.instance';

const inputSchema = z.object({
  channelName: z.string().min(1),
  content: z.string().min(1),
  meta: z.record(z.string(), z.string()).optional(),
  /** Deliver to this session only (session-scoped events such as agent and job completions). */
  targetSessionId: z.string().min(1).optional(),
});

const outputSchema = z.object({
  sent: z.boolean(),
  channelName: z.string(),
});

const stateSchema = z.object({
  channelName: z.string(),
  content: z.string(),
  meta: z.record(z.string(), z.string()).optional(),
  targetSessionId: z.string().optional(),
  output: outputSchema.optional(),
});

const plan = {
  pre: ['parseInput', 'resolveMeta'],
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

/**
 * Every channel notification runs this flow: the ones a channel pushes (`channel.pushNotification()`,
 * which every source uses) and manual pushes through `scope.channelNotifications.send()`. Hooks see
 * the final metadata from `Will('send')` on, and can stop a notification there.
 */
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
      targetSessionId: data.targetSessionId,
    });
    this.logger.verbose('parseInput:done');
  }

  /**
   * The notification's metadata: the server's `channels.defaultMeta`, then the channel's own `meta`,
   * then the notification's, with `source` always the channel name.
   */
  @Stage('resolveMeta')
  async resolveMeta() {
    const { channelName } = this.state.required;
    const { meta } = this.state;
    const channel = this.findChannel(channelName);
    const resolved: ChannelNotificationMeta = {
      ...(this.scope.channelNotifications?.defaultMeta ?? {}),
      ...(channel?.staticMeta ?? {}),
      ...(meta ?? {}),
      source: channelName,
    };
    this.state.set('meta', resolved);
  }

  @Stage('send')
  async send() {
    this.logger.verbose('send:start');

    const { channelName, content } = this.state.required;
    const { targetSessionId } = this.state;
    const meta: ChannelNotificationMeta = { ...(this.state.meta ?? {}), source: channelName };

    // Only global events are buffered: a session-scoped one belongs to its session alone.
    const channel = this.findChannel(channelName);
    if (channel && !targetSessionId) channel.recordForReplay({ content, meta });

    const channelNotifications = this.scope.channelNotifications;
    if (!channelNotifications) {
      this.logger.warn('Channel notification service not available');
      this.state.set('output', { sent: false, channelName });
      return;
    }

    const sent = targetSessionId
      ? channelNotifications.sendToSession(targetSessionId, content, meta)
      : (channelNotifications.sendToSubscribedSessions(content, meta), true);
    this.state.set('output', { sent, channelName });

    this.logger.verbose('send:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const output = this.state.output ?? { sent: false, channelName: this.state.required.channelName };
    this.respond(output);
    this.logger.verbose('finalize:done');
  }

  private findChannel(channelName: string): ChannelInstance | undefined {
    return this.scope.channels?.findByName(channelName);
  }
}
