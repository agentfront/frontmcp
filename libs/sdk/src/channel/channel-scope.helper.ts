// file: libs/sdk/src/channel/channel-scope.helper.ts

import { type Token } from '@frontmcp/di';

import { type EntryOwnerRef, type FrontMcpLogger, type ServerRequestHandler } from '../common';
import { type ChannelType } from '../common/interfaces/channel.interface';
import {
  type ChannelAgentCompletionSource,
  type ChannelJobCompletionSource,
  type ChannelsConfigOptions,
  type ChannelWebhookSource,
} from '../common/metadata/channel.metadata';
import type FlowRegistry from '../flows/flow.registry';
import type { NotificationService } from '../notification/notification.service';
import type ProviderRegistry from '../provider/provider.registry';
import {
  assertNotReserved,
  computeReservedPaths,
  wrapWithIpFilter,
  type CheckClientIpFn,
  type HttpRouteRegistrar,
} from '../server/custom-routes.helper';
import { loadExternalToolRecords } from '../tool/tool-external.loader';
import { ToolInstance } from '../tool/tool.instance';
import type ToolRegistry from '../tool/tool.registry';
import { isExternalToolRecord, normalizeTool } from '../tool/tool.utils';
import { ChannelNotificationService } from './channel-notification.service';
import ChannelRegistry from './channel.registry';
import ListChannelsFlow from './flows/list-channels.flow';
import SendChannelNotificationFlow from './flows/send-channel-notification.flow';
import { ChannelReplyTool } from './reply/channel-reply.tool';
import { wireAgentCompletionSource, type AgentCompletionEvent } from './sources/agent-completion.source';
import { ChannelEventBus, wireAppEventSource } from './sources/app-event.source';
import { completionEventsOf } from './sources/completion-events';
import { wireJobCompletionSource, type JobCompletionEvent } from './sources/job-completion.source';
import { createWebhookMiddleware } from './sources/webhook.source';

/** Subscribe to one kind of completion event; returns the unsubscribe function. */
type CompletionSubscribe<T> = (cb: (event: T) => void) => () => void;

export interface RegisterChannelCapabilitiesArgs {
  providers: ProviderRegistry;
  owner: EntryOwnerRef;
  channelsList: ChannelType[];
  /** The provider registry of each channel declared on an app, by its token (see `appEntryProviders`). */
  channelProviders?: ReadonlyMap<Token, ProviderRegistry>;
  channelsConfig: ChannelsConfigOptions;
  notificationService: NotificationService;
  flowRegistry: FlowRegistry;
  toolRegistry: ToolRegistry;
  /** Optional agent emitter subscribe function for agent-completion sources */
  agentEmitterSubscribe?: (cb: (event: unknown) => void) => () => void;
  /** Optional job emitter subscribe function for job-completion sources */
  jobEmitterSubscribe?: (cb: (event: unknown) => void) => () => void;
  /**
   * Where `webhook` sources get their HTTP route: the scope's server, with the same reserved-path
   * guard and `throttle.ipFilter` check as custom `http.routes`. Without it, webhook sources get
   * no route.
   */
  http?: {
    server: HttpRouteRegistrar;
    checkClientIp: CheckClientIpFn;
    entryPath: string;
    routeBase: string;
    healthPaths?: readonly string[];
  };
  logger: FrontMcpLogger;
}

export interface ChannelCapabilitiesResult {
  channelRegistry: ChannelRegistry;
  channelNotificationService: ChannelNotificationService;
  channelEventBus: ChannelEventBus;
  /** Runs each service channel's `onConnect()`: call it once the scope serves the registry and notification service. */
  connectServices: () => Promise<void>;
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
    channelProviders,
    channelsConfig,
    notificationService,
    flowRegistry,
    toolRegistry,
    http,
    logger,
  } = args;

  // Agent and job completions come from the scope's completion events (published by the
  // agents:call-agent flow and the job execution manager) unless the caller supplies its own.
  const completions = completionEventsOf(providers.getActiveScope());
  const agentEmitterSubscribe =
    args.agentEmitterSubscribe ?? ((cb: (event: unknown) => void) => completions.agents.subscribe(cb));
  const jobEmitterSubscribe =
    args.jobEmitterSubscribe ?? ((cb: (event: unknown) => void) => completions.jobs.subscribe(cb));

  const unsubscribers: (() => void)[] = [];
  const reservedPaths = http ? computeReservedPaths(http.entryPath, http.routeBase, http.healthPaths) : undefined;
  const webhookPaths = new Map<string, string>();

  // 1. Initialize channel registry
  const channelRegistry = new ChannelRegistry(providers, channelsList, owner, channelProviders);
  await channelRegistry.ready;

  // 2. Create notification service (with server-level default metadata if configured). Its `send()`
  // runs the hookable `channels:send-notification` flow, as every channel notification does.
  const channelNotificationService = new ChannelNotificationService(
    notificationService,
    logger,
    channelsConfig?.defaultMeta,
    (input) => flowRegistry.runFlow('channels:send-notification', input),
  );

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
        const unsub = wireAgentCompletionSource(
          instance,
          instance.metadata.source as ChannelAgentCompletionSource,
          agentEmitterSubscribe as CompletionSubscribe<AgentCompletionEvent>,
          logger,
        );
        unsubscribers.push(unsub);
        break;
      }
      case 'job-completion': {
        const unsub = wireJobCompletionSource(
          instance,
          instance.metadata.source as ChannelJobCompletionSource,
          jobEmitterSubscribe as CompletionSubscribe<JobCompletionEvent>,
          logger,
        );
        unsubscribers.push(unsub);
        break;
      }
      case 'app-event': {
        const eventName = (instance.metadata.source as { event: string }).event;
        const unsub = wireAppEventSource(instance, eventName, channelEventBus, logger);
        unsubscribers.push(unsub);
        break;
      }
      case 'webhook': {
        const source = instance.metadata.source as ChannelWebhookSource;
        if (!http || !reservedPaths) {
          logger.warn(`Channel "${instance.name}" has a webhook source but no HTTP server to serve ${source.path}`);
          break;
        }
        // Same guards as a custom http.route: never on a FrontMCP path, never two channels on one path.
        assertNotReserved('POST', source.path, reservedPaths);
        const claimedBy = webhookPaths.get(source.path);
        if (claimedBy) {
          throw new Error(
            `Channels "${claimedBy}" and "${instance.name}" both declare the webhook path ${source.path}. ` +
              `Give each webhook channel its own path.`,
          );
        }
        webhookPaths.set(source.path, instance.name);
        const handler = createWebhookMiddleware(instance, source, logger) as unknown as ServerRequestHandler;
        await http.server.registerRoute('POST', source.path, wrapWithIpFilter(handler, http.checkClientIp));
        logger.info(`Registered webhook route for channel "${instance.name}": POST ${source.path}`);
        break;
      }
      case 'manual':
        // Manual sources have no automatic wiring
        break;
      case 'service':
      case 'file-watcher':
        // Service connectors and file watchers connect through connectServices() (onConnect())
        break;
    }
  }

  // 6. Register channel flows
  await flowRegistry.registryFlows([SendChannelNotificationFlow, ListChannelsFlow]);

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
          const toolRecords = isExternalToolRecord(toolRecord)
            ? await loadExternalToolRecords(providers.getActiveScope(), toolRecord)
            : [toolRecord];
          for (const record of toolRecords) {
            // The channel's own providers: its app's when an app declares it, as its hooks get
            const toolInstance = new ToolInstance(record, instance.providers, {
              kind: 'scope',
              id: `_channel:${instance.name}`,
              ref: toolDef as any,
            });
            await toolInstance.ready;
            toolRegistry.registerToolInstance(toolInstance);
            channelToolCount++;
          }
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

  const serviceChannels = channelRegistry.getChannelInstances().filter((ch) => ch.isServiceConnector);

  logger.info(
    `Channel system initialized: ${channelRegistry.size} channel(s)` +
      (hasTwoWayChannels ? ', reply tool' : '') +
      (channelToolCount > 0 ? `, ${channelToolCount} channel tool(s)` : '') +
      (serviceChannels.length > 0 ? `, ${serviceChannels.length} service connector(s)` : ''),
  );

  const teardown = async () => {
    // Disconnect service connectors (best-effort — don't abort on first failure)
    const results = await Promise.allSettled(serviceChannels.map((instance) => instance.disconnectService()));
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error('Channel disconnect failed during teardown', { error: result.reason });
      }
    }
    for (const unsub of unsubscribers) unsub();
    channelEventBus.clear();
  };

  return {
    channelRegistry,
    channelNotificationService,
    channelEventBus,
    connectServices: async () => {
      try {
        for (const instance of serviceChannels) await instance.connectService();
      } catch (err) {
        await teardown();
        throw err;
      }
    },
    teardown,
  };
}
