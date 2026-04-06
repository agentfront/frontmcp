import { LogLevel } from '@frontmcp/sdk';
import { ChannelsApp } from './apps/channels';

export const serverConfig = {
  info: { name: 'Demo E2E Channels', version: '0.1.0' },
  apps: [ChannelsApp],
  logging: { level: LogLevel.Warn, enableConsole: true },
  auth: { mode: 'public' as const },
  channels: { enabled: true },
};
