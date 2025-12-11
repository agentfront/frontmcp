// file: libs/sdk/src/notification/index.ts

export {
  NotificationService,
  type McpNotificationMethod,
  type RegisteredServer,
  type McpLoggingLevel,
  MCP_LOGGING_LEVEL_PRIORITY,
  type Root,
  type ClientCapabilities,
  type ClientInfo,
  type AIPlatformType,
  detectAIPlatform,
  detectPlatformFromUserAgent,
  detectPlatformFromCapabilities,
  hasMcpAppsExtension,
  MCP_APPS_EXTENSION_KEY,
} from './notification.service';
