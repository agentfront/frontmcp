// file: libs/browser/src/telemetry/mcp/index.ts
/**
 * Telemetry MCP Integration
 *
 * MCP resources and notifications for telemetry data.
 */

// Resources
export {
  createTelemetryResources,
  createEventQueryResource,
  createEventTypeResource,
  createRecentEventsResource,
  type TelemetryResourcesOptions,
  type TelemetryResource,
} from './event-resources';

// Notifications
export {
  createEventNotifier,
  connectNotifierToCollector,
  createSimpleNotificationHandler,
  type NotificationTransport,
  type EventNotifierOptions,
  type EventNotifier,
  type EventNotificationPayload,
} from './event-notifications';
