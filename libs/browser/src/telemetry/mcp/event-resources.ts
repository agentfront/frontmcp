// file: libs/browser/src/telemetry/mcp/event-resources.ts
/**
 * Telemetry Event Resources
 *
 * MCP resources for exposing telemetry data.
 *
 * @example
 * ```typescript
 * const collector = createEventCollector({ ... });
 * const resources = createTelemetryResources(collector);
 *
 * // Register with browser scope
 * for (const resource of resources) {
 *   scope.registerResource(resource);
 * }
 * ```
 */

import type { ScopeResourceDefinition } from '../../scope/types';
import type { EventCollector, TelemetryEvent, TelemetryCategory, TelemetryStats } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating telemetry resources.
 */
export interface TelemetryResourcesOptions {
  /**
   * URI prefix for resources.
   * Default: 'events://'
   */
  uriPrefix?: string;

  /**
   * Maximum events to return for recent events resource.
   * Default: 100
   */
  maxRecentEvents?: number;

  /**
   * Include individual category resources (network, error, etc.).
   * Default: true
   */
  includeCategories?: boolean;

  /**
   * Include stats resource.
   * Default: true
   */
  includeStats?: boolean;

  /**
   * Include recent events resource.
   * Default: true
   */
  includeRecent?: boolean;
}

/**
 * Single telemetry resource definition.
 */
export interface TelemetryResource extends ScopeResourceDefinition<{ uri: string; mimeType: string; text: string }> {
  /** Category filter (if applicable) */
  category?: TelemetryCategory | string;

  /** Resource type */
  resourceType: 'recent' | 'category' | 'stats';
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create MCP resources for telemetry data.
 *
 * Creates resources for:
 * - `events://recent` - Recent events (all categories)
 * - `events://errors` - Error events only
 * - `events://network` - Network events only
 * - `events://interactions` - Interaction events only
 * - `events://logs` - Log events only
 * - `events://stats` - Aggregated statistics
 *
 * @param collector - Event collector instance
 * @param options - Resource generation options
 * @returns Array of resource definitions
 */
export function createTelemetryResources(
  collector: EventCollector,
  options: TelemetryResourcesOptions = {},
): TelemetryResource[] {
  const {
    uriPrefix = 'events://',
    maxRecentEvents = 100,
    includeCategories = true,
    includeStats = true,
    includeRecent = true,
  } = options;

  const resources: TelemetryResource[] = [];

  // Helper to serialize events
  const serialize = (data: unknown): string => JSON.stringify(data, null, 2);

  // Recent events resource
  if (includeRecent) {
    const recentUri = `${uriPrefix}recent`;
    resources.push({
      uri: recentUri,
      name: 'Recent Events',
      description: `Last ${maxRecentEvents} telemetry events`,
      mimeType: 'application/json',
      resourceType: 'recent',
      handler: () => {
        const events = collector.getBuffer();
        const recent = events.slice(-maxRecentEvents);

        return {
          uri: recentUri,
          mimeType: 'application/json',
          text: serialize({
            count: recent.length,
            events: recent,
            sessionId: collector.sessionId,
          }),
        };
      },
    });
  }

  // Category-specific resources
  if (includeCategories) {
    const categories: Array<{
      name: string;
      category: TelemetryCategory | string;
      description: string;
    }> = [
      { name: 'errors', category: 'error' as TelemetryCategory, description: 'Error events' },
      { name: 'network', category: 'network' as TelemetryCategory, description: 'Network events' },
      { name: 'interactions', category: 'interaction' as TelemetryCategory, description: 'User interaction events' },
      { name: 'logs', category: 'log' as TelemetryCategory, description: 'Log events' },
      { name: 'navigation', category: 'navigation' as TelemetryCategory, description: 'Navigation events' },
      { name: 'performance', category: 'performance' as TelemetryCategory, description: 'Performance events' },
      { name: 'custom', category: 'custom' as TelemetryCategory, description: 'Custom events' },
    ];

    for (const { name, category, description } of categories) {
      const uri = `${uriPrefix}${name}`;
      resources.push({
        uri,
        name: `${name.charAt(0).toUpperCase() + name.slice(1)} Events`,
        description,
        mimeType: 'application/json',
        resourceType: 'category',
        category,
        handler: () => {
          const events = collector.getBuffer().filter((e) => e.category === category);

          return {
            uri,
            mimeType: 'application/json',
            text: serialize({
              count: events.length,
              category,
              events,
              sessionId: collector.sessionId,
            }),
          };
        },
      });
    }
  }

  // Stats resource
  if (includeStats) {
    const statsUri = `${uriPrefix}stats`;
    resources.push({
      uri: statsUri,
      name: 'Telemetry Stats',
      description: 'Aggregated telemetry statistics',
      mimeType: 'application/json',
      resourceType: 'stats',
      handler: () => {
        const stats = collector.getStats();
        const buffer = collector.getBuffer();

        // Calculate additional stats
        const now = Date.now();
        const sessionDuration = now - stats.sessionStart;

        // Get unique event types per category
        const typesByCategory: Record<string, string[]> = {};
        for (const event of buffer) {
          if (!typesByCategory[event.category]) {
            typesByCategory[event.category] = [];
          }
          if (!typesByCategory[event.category].includes(event.type)) {
            typesByCategory[event.category].push(event.type);
          }
        }

        // Calculate events per minute
        const eventsPerMinute = sessionDuration > 0 ? (stats.totalEvents / (sessionDuration / 60000)).toFixed(2) : '0';

        return {
          uri: statsUri,
          mimeType: 'application/json',
          text: serialize({
            sessionId: collector.sessionId,
            enabled: collector.enabled,
            bufferSize: collector.bufferSize,
            stats: {
              ...stats,
              sessionDuration,
              eventsPerMinute: parseFloat(eventsPerMinute),
              typesByCategory,
            },
          }),
        };
      },
    });
  }

  return resources;
}

/**
 * Create a single resource for a specific event query.
 *
 * @example
 * ```typescript
 * const highSeverityErrors = createEventQueryResource(collector, {
 *   uri: 'events://high-severity',
 *   name: 'High Severity Events',
 *   filter: (event) => event.significance === 'high',
 * });
 * ```
 */
export function createEventQueryResource(
  collector: EventCollector,
  options: {
    uri: string;
    name: string;
    description?: string;
    filter: (event: TelemetryEvent) => boolean;
    transform?: (events: TelemetryEvent[]) => unknown;
  },
): ScopeResourceDefinition<{ uri: string; mimeType: string; text: string }> {
  const { uri, name, description, filter, transform } = options;

  return {
    uri,
    name,
    description,
    mimeType: 'application/json',
    handler: () => {
      const events = collector.getBuffer().filter(filter);
      const data = transform ? transform(events) : { count: events.length, events };

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      };
    },
  };
}

/**
 * Create a resource that returns events matching a specific type.
 */
export function createEventTypeResource(
  collector: EventCollector,
  eventType: string,
  options: {
    uriPrefix?: string;
    name?: string;
    description?: string;
  } = {},
): ScopeResourceDefinition<{ uri: string; mimeType: string; text: string }> {
  const { uriPrefix = 'events://', name, description } = options;
  const uri = `${uriPrefix}type/${eventType}`;

  return {
    uri,
    name: name ?? `${eventType} Events`,
    description: description ?? `Events of type "${eventType}"`,
    mimeType: 'application/json',
    handler: () => {
      const events = collector.getBuffer().filter((e) => e.type === eventType);

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            count: events.length,
            type: eventType,
            events,
            sessionId: collector.sessionId,
          },
          null,
          2,
        ),
      };
    },
  };
}

/**
 * Create a resource that returns the most recent N events.
 */
export function createRecentEventsResource(
  collector: EventCollector,
  count: number,
  options: {
    uri?: string;
    name?: string;
  } = {},
): ScopeResourceDefinition<{ uri: string; mimeType: string; text: string }> {
  const { uri = `events://recent/${count}`, name = `Last ${count} Events` } = options;

  return {
    uri,
    name,
    description: `The ${count} most recent telemetry events`,
    mimeType: 'application/json',
    handler: () => {
      const events = collector.getBuffer().slice(-count);

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            count: events.length,
            requestedCount: count,
            events,
            sessionId: collector.sessionId,
          },
          null,
          2,
        ),
      };
    },
  };
}
