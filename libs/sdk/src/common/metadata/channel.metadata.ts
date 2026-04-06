import { z } from 'zod';
import { RawZodShape } from '../types';
import type { EntryAvailability } from '@frontmcp/utils';
import { entryAvailabilitySchema } from '@frontmcp/utils';
import type { ToolType } from '../interfaces/tool.interface';

// ============================================
// Channel Source Configuration
// ============================================

/**
 * Webhook source — registers an HTTP POST endpoint that receives external events.
 */
export interface ChannelWebhookSource {
  type: 'webhook';
  /** HTTP path for the webhook endpoint (e.g., '/hooks/deploy') */
  path: string;
}

/**
 * App event source — subscribes to in-process events via the ChannelEventBus.
 */
export interface ChannelAppEventSource {
  type: 'app-event';
  /** Event name to subscribe to */
  event: string;
}

/**
 * Agent completion source — auto-pushes when agents finish execution.
 */
export interface ChannelAgentCompletionSource {
  type: 'agent-completion';
  /** Optional filter: only notify for these agent IDs */
  agentIds?: string[];
}

/**
 * Job completion source — auto-pushes when jobs/workflows complete.
 */
export interface ChannelJobCompletionSource {
  type: 'job-completion';
  /** Optional filter: only notify for these job names */
  jobNames?: string[];
}

/**
 * Manual source — programmatic push only via scope.channelNotifications.
 */
export interface ChannelManualSource {
  type: 'manual';
}

/**
 * Service connector source — channel maintains a persistent connection to an external service.
 * The channel's `onConnect()` establishes the connection and `onDisconnect()` tears it down.
 * Claude sends messages via the channel's declared tools, and incoming messages trigger `onEvent()`.
 *
 * @example WhatsApp service connector
 * ```typescript
 * @Channel({
 *   name: 'whatsapp',
 *   source: { type: 'service', service: 'whatsapp-business' },
 *   tools: [SendWhatsAppTool],
 *   twoWay: true,
 * })
 * ```
 */
export interface ChannelServiceSource {
  type: 'service';
  /** Human-readable service identifier (e.g., 'whatsapp-business', 'telegram-bot', 'slack') */
  service: string;
}

/**
 * File watcher source — watches file system paths for changes and pushes events.
 * Uses the channel's `onConnect()` to start watching and `onDisconnect()` to stop.
 *
 * @example Watch log files for errors
 * ```typescript
 * @Channel({
 *   name: 'log-watcher',
 *   source: { type: 'file-watcher', paths: ['./logs/*.log'], events: ['change', 'create'] },
 * })
 * ```
 */
export interface ChannelFileWatcherSource {
  type: 'file-watcher';
  /** Glob patterns or specific file paths to watch */
  paths: string[];
  /** File system events to watch for */
  events?: Array<'change' | 'create' | 'delete' | 'rename'>;
}

/**
 * Discriminated union of all channel source configurations.
 */
export type ChannelSourceConfig =
  | ChannelWebhookSource
  | ChannelAppEventSource
  | ChannelAgentCompletionSource
  | ChannelJobCompletionSource
  | ChannelManualSource
  | ChannelServiceSource
  | ChannelFileWatcherSource;

// ============================================
// Channel Notification Type
// ============================================

/**
 * The notification payload sent to Claude Code sessions.
 * Maps to `notifications/claude/channel` params.
 */
export interface ChannelNotification {
  /** The notification content (appears inside <channel> tags in Claude) */
  content: string;
  /** Optional metadata key-value pairs (become XML attributes on the <channel> tag) */
  meta?: Record<string, string>;
}

// ============================================
// Channel Metadata
// ============================================

declare global {
  /**
   * Declarative metadata extends for the Channel decorator.
   */
  interface ExtendFrontMcpChannelMetadata {}
}

/**
 * Declarative metadata describing a notification channel.
 *
 * @example
 * ```typescript
 * @Channel({
 *   name: 'deploy-alerts',
 *   description: 'CI/CD deployment notifications',
 *   source: { type: 'webhook', path: '/hooks/deploy' },
 *   twoWay: true,
 *   meta: { team: 'platform' },
 * })
 * ```
 */
export interface ChannelMetadata extends ExtendFrontMcpChannelMetadata {
  /**
   * Unique name for the channel.
   * Used as the source identifier in channel notifications.
   */
  name: string;

  /**
   * Human-readable description of what this channel does.
   * Included in the server instructions sent to Claude Code.
   */
  description?: string;

  /**
   * The source that feeds events into this channel.
   */
  source: ChannelSourceConfig;

  /**
   * Whether this channel supports two-way communication.
   * When true, a reply tool is auto-registered so Claude can send messages back.
   * @default false
   */
  twoWay?: boolean;

  /**
   * Static metadata appended to every notification from this channel.
   * Keys must be valid identifiers (letters, digits, underscores).
   */
  meta?: Record<string, string>;

  /**
   * Event replay configuration.
   * When enabled, events are buffered so they can be replayed when Claude Code connects.
   * Use this for channels where events should not be lost if Claude is not connected.
   *
   * The buffer is in-memory by default. For persistence across restarts, provide an
   * external store via `onConnect()`.
   *
   * @example
   * ```typescript
   * @Channel({
   *   name: 'ci-alerts',
   *   source: { type: 'webhook', path: '/hooks/ci' },
   *   replay: { enabled: true, maxEvents: 100 },
   * })
   * ```
   */
  replay?: {
    /** Enable event buffering for replay */
    enabled: boolean;
    /** Maximum number of events to buffer (default: 50) */
    maxEvents?: number;
  };

  /**
   * Tools contributed by this channel.
   * These tools are auto-registered in the scope's tool registry and give Claude
   * the ability to send messages or perform actions through the channel's service.
   *
   * For service connectors (source: { type: 'service' }), these tools represent the
   * outbound side of the channel — Claude calls them to send messages, and incoming
   * responses arrive back through the channel's `onEvent()` as notifications.
   *
   * @example
   * ```typescript
   * @Channel({
   *   name: 'whatsapp',
   *   source: { type: 'service', service: 'whatsapp-business' },
   *   tools: [SendWhatsAppMessageTool],
   *   twoWay: true,
   * })
   * ```
   */
  tools?: ToolType[];

  /**
   * Tags for categorization and filtering.
   */
  tags?: string[];

  /**
   * Environment availability constraint.
   */
  availableWhen?: EntryAvailability;
}

// ============================================
// Zod Schemas
// ============================================

const channelWebhookSourceSchema = z.object({
  type: z.literal('webhook'),
  path: z.string().min(1),
});

const channelAppEventSourceSchema = z.object({
  type: z.literal('app-event'),
  event: z.string().min(1),
});

const channelAgentCompletionSourceSchema = z.object({
  type: z.literal('agent-completion'),
  agentIds: z.array(z.string().min(1)).optional(),
});

const channelJobCompletionSourceSchema = z.object({
  type: z.literal('job-completion'),
  jobNames: z.array(z.string().min(1)).optional(),
});

const channelManualSourceSchema = z.object({
  type: z.literal('manual'),
});

const channelServiceSourceSchema = z.object({
  type: z.literal('service'),
  service: z.string().min(1),
});

const channelFileWatcherSourceSchema = z.object({
  type: z.literal('file-watcher'),
  paths: z.array(z.string().min(1)).min(1),
  events: z.array(z.enum(['change', 'create', 'delete', 'rename'])).optional(),
});

export const channelSourceConfigSchema = z.discriminatedUnion('type', [
  channelWebhookSourceSchema,
  channelAppEventSourceSchema,
  channelAgentCompletionSourceSchema,
  channelJobCompletionSourceSchema,
  channelManualSourceSchema,
  channelServiceSourceSchema,
  channelFileWatcherSourceSchema,
]);

/**
 * Regex for valid meta key identifiers (letters, digits, underscores).
 * Per Claude Code channels spec: keys must be valid identifiers.
 */
const META_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const channelMetaSchema = z.record(
  z.string().regex(META_KEY_PATTERN, 'Meta keys must be valid identifiers (letters, digits, underscores)'),
  z.string(),
);

export const frontMcpChannelMetadataSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    source: channelSourceConfigSchema,
    twoWay: z.boolean().optional().default(false),
    meta: channelMetaSchema.optional(),
    replay: z
      .object({
        enabled: z.boolean(),
        maxEvents: z.number().min(1).optional().default(50),
      })
      .optional(),
    tools: z.array(z.any()).optional(),
    tags: z.array(z.string().min(1)).optional(),
    availableWhen: entryAvailabilitySchema.optional(),
  } satisfies RawZodShape<ChannelMetadata, ExtendFrontMcpChannelMetadata>)
  .passthrough();

/**
 * Channel notification payload schema.
 */
export const channelNotificationSchema = z.object({
  content: z.string().min(1),
  meta: channelMetaSchema.optional(),
});

// ============================================
// Channels Config (for @FrontMcp metadata)
// ============================================

/**
 * Channels configuration at the server level.
 */
export interface ChannelsConfigOptions {
  /** Enable the channels system */
  enabled: boolean;
  /** Default metadata appended to all channel notifications */
  defaultMeta?: Record<string, string>;
}

export type ChannelsConfigInput = ChannelsConfigOptions;

export const channelsConfigSchema = z.object({
  enabled: z.boolean(),
  defaultMeta: channelMetaSchema.optional(),
});
