export { HaManager, type HaManagerOptions } from './ha-manager';
export { HeartbeatService, type HeartbeatRedisClient } from './heartbeat.service';
export { attemptSessionTakeover, type TakeoverRedisClient } from './session-takeover';
export { NotificationRelay, type RelayRedisClient, type RelayHandler, type RelayMessage } from './notification-relay';
export { DEFAULT_FRONTMCP_NODE_COOKIE, DEFAULT_FRONTMCP_MACHINE_ID_HEADER } from './ha.constants';
export type { HaConfig, DeploymentMode, HeartbeatValue, TakeoverResult } from './ha.types';
export { DEFAULT_HA_CONFIG } from './ha.types';
