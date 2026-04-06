// file: libs/sdk/src/channel/channel-scope.helper.ts

import { FrontMcpLogger, EntryOwnerRef } from '../common';
import { ChannelType } from '../common/interfaces/channel.interface';
import { ChannelsConfigOptions } from '../common/metadata/channel.metadata';
import ProviderRegistry from '../provider/provider.registry';
import ChannelRegistry from './channel.registry';
import { ChannelNotificationService } from './channel-notification.service';
import { ChannelEventBus, wireAppEventSource } from './sources/app-event.source';
import { wireAgentCompletionSource } from './sources/agent-completion.source';
import { wireJobCompletionSource } from './sources/job-completion.source';
import { ChannelReplyTool } from './reply/channel-reply.tool';
import { normalizeTool } from '../tool/tool.utils';
import { ToolInstance } from '../tool/tool.instance';
import type { NotificationService } from '../notification/notification.service';
import type FlowRegistry from '../flows/flow.registry';
import type ToolRegistry from '../tool/tool.registry';
import SendChannelNotificationFlow from './flows/send-channel-notification.flow';
import ListChannelsFlow from './flows/list-channels.flow';

export interface RegisterChannelCapabilitiesArgs {
  providers: ProviderRegistry;
  owner: EntryOwnerRef;
  channelsList: ChannelType[];
  channelsConfig: ChannelsConfigOptions;
  notificationService: NotificationService;
  flowRegistry: FlowRegistry;
  toolRegistry: ToolRegistry;
  /** Optional agent emitter subscribe function for agent-completion sources */
  agentEmitterSubscribe?: (cb: (event: unknown) => void) => () => void;
  /** Optional job emitter subscribe function for job-completion sources */
  jobEmitterSubscribe?: (cb: (event: unknown) => void) => () => void;
  logger: FrontMcpLogger;
}

export interface ChannelCapabilitiesResult {
  channelRegistry: ChannelRegistry;
  channelNotificationService: ChannelNotificationService;
  channelEventBus: ChannelEventBus;
  /** Teardown function: disconnects services and cleans up subscriptions */
  teardown: () => Promise<void>;
}

/**
 * Helper function for registering channel capabilities in scope.
 * Follows the skill-scope.helper.ts and job-scope.helper.ts patterns.
 */
export async function registerChannelCapabilities(
  args: RegisterChannelCapabilitiesArgs,
): Promise<ChannelCapabilitiesResult> {
  const {
    providers,
    owner,
    channelsList,
    channelsConfig,
    notificationService,
    flowRegistry,
    toolRegistry,
    agentEmitterSubscribe,
    jobEmitterSubscribe,
    logger,
  } = args;

  const unsubscribers: (() => void)[] = [];

  // 1. Initialize channel registry
  const channelRegistry = new ChannelRegistry(providers, channelsList, owner);
  await channelRegistry.ready;

  // 2. Create notification service
  const channelNotificationService = new ChannelNotificationService(notificationService, logger);

  // 3. Create event bus for app-event sources
  const channelEventBus = new ChannelEventBus(logger);

  // 4. Wire notification service to all channel instances
  for (const instance of channelRegistry.getChannelInstances()) {
    instance.setNotificationService(channelNotificationService);
  }

  // 5. Wire channel sources
  for (const instance of channelRegistry.getChannelInstances()) {
    const sourceType = instance.source.type;

    switch (sourceType) {
      case 'agent-completion': {
        if (agentEmitterSubscribe) {
          const unsub = wireAgentCompletionSource(
            instance,
            instance.metadata.source as any,
            agentEmitterSubscribe as any,
            logger,
          );
          unsubscribers.push(unsub);
        } else {
          logger.warn(`Channel "${instance.name}" has agent-completion source but no agent emitter available`);
        }
        break;
      }
      case 'job-completion': {
        if (jobEmitterSubscribe) {
          const unsub = wireJobCompletionSource(
            instance,
            instance.metadata.source as any,
            jobEmitterSubscribe as any,
            logger,
          );
          unsubscribers.push(unsub);
        } else {
          logger.warn(`Channel "${instance.name}" has job-completion source but no job emitter available`);
        }
        break;
      }
      case 'app-event': {
        const eventName = (instance.metadata.source as { event: string }).event;
        const unsub = wireAppEventSource(instance, eventName, channelEventBus, logger);
        unsubscribers.push(unsub);
        break;
      }
      case 'webhook':
      case 'manual':
        // Webhook sources are wired via HTTP middleware (handled by transport layer)
        // Manual sources have no automatic wiring
        break;
      case 'service':
      case 'file-watcher':
        // Service connectors and file watchers are connected in step 9 via onConnect()
        break;
    }
  }

  // 6. Register channel flows
  flowRegistry.registryFlows([SendChannelNotificationFlow, ListChannelsFlow]);

  // 7. Register reply tool if any channel is two-way
  const hasTwoWayChannels = channelRegistry.getChannelInstances().some((ch) => ch.twoWay);
  if (hasTwoWayChannels) {
    const replyToolRecord = normalizeTool(ChannelReplyTool);
    const replyToolInstance = new ToolInstance(replyToolRecord, providers, owner);
    await replyToolInstance.ready;
    toolRegistry.registerToolInstance(replyToolInstance);
    logger.info('Registered channel-reply tool for two-way channel communication');
  }

  // 8. Register channel-contributed tools (e.g., send-whatsapp-message)
  let channelToolCount = 0;
  for (const instance of channelRegistry.getChannelInstances()) {
    const channelTools = instance.metadata.tools;
    if (channelTools && channelTools.length > 0) {
      for (const toolDef of channelTools) {
        try {
          const toolRecord = normalizeTool(toolDef);
          const toolInstance = new ToolInstance(toolRecord, providers, {
            kind: 'scope',
            id: `_channel:${instance.name}`,
            ref: toolDef as any,
          });
          await toolInstance.ready;
          toolRegistry.registerToolInstance(toolInstance);
          channelToolCount++;
        } catch (error) {
          logger.warn(
            `Failed to register tool from channel "${instance.name}": ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }
  if (channelToolCount > 0) {
    logger.info(`Registered ${channelToolCount} tool(s) from channel declarations`);
  }

  // 9. Connect service connector channels (persistent connections)
  const serviceChannels = channelRegistry.getChannelInstances().filter((ch) => ch.isServiceConnector);
  for (const instance of serviceChannels) {
    await instance.connectService();
  }

  logger.info(
    `Channel system initialized: ${channelRegistry.size} channel(s)` +
      (hasTwoWayChannels ? ', reply tool' : '') +
      (channelToolCount > 0 ? `, ${channelToolCount} channel tool(s)` : '') +
      (serviceChannels.length > 0 ? `, ${serviceChannels.length} service connector(s)` : ''),
  );

  return {
    channelRegistry,
    channelNotificationService,
    channelEventBus,
    teardown: async () => {
      // Disconnect service connectors
      for (const instance of serviceChannels) {
        await instance.disconnectService();
      }
      for (const unsub of unsubscribers) unsub();
      channelEventBus.clear();
    },
  };
}
