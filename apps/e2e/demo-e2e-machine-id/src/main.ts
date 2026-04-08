import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import MachineIdApp from './apps/machine-id';

export const serverConfig = {
  info: { name: 'Demo E2E Machine ID', version: '0.1.0' },
  apps: [MachineIdApp],
  logging: { level: LogLevel.Warn },
  auth: { mode: 'public' as const },
};

@FrontMcp({
  ...serverConfig,
  http: { port: 0 },
  serve: false,
})
export default class Server {}
