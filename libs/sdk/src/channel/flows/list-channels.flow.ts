// file: libs/sdk/src/channel/flows/list-channels.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions } from '../../common';
import { z } from 'zod';
import type ChannelRegistry from '../channel.registry';

const inputSchema = z.object({}).optional();

const channelInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  sourceType: z.string(),
  twoWay: z.boolean(),
  tags: z.array(z.string()),
});

const outputSchema = z.object({
  channels: z.array(channelInfoSchema),
  count: z.number(),
});

const stateSchema = z.object({
  output: outputSchema.optional(),
});

const plan = {
  execute: ['listChannels'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'channels:list': FlowRunOptions<
      ListChannelsFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'channels:list' as const;
const { Stage } = FlowHooksOf<'channels:list'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class ListChannelsFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('ListChannelsFlow');

  @Stage('listChannels')
  async listChannels() {
    this.logger.verbose('listChannels:start');

    const scope = this.scope as unknown as { channels?: ChannelRegistry };
    const channelRegistry = scope.channels;
    if (!channelRegistry) {
      this.state.set({ output: { channels: [], count: 0 } });
      return;
    }

    const channels = channelRegistry.getChannels().map((ch) => ({
      name: ch.name,
      description: ch.metadata.description,
      sourceType: ch.source.type,
      twoWay: ch.twoWay,
      tags: ch.getTags(),
    }));

    this.state.set({ output: { channels, count: channels.length } });
    this.logger.verbose('listChannels:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    this.respond(this.state.required.output ?? { channels: [], count: 0 });
    this.logger.verbose('finalize:done');
  }
}
