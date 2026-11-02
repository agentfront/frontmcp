import { FrontMcpInstance } from '@frontmcp/sdk';

import { serverConfig } from './config';

FrontMcpInstance.runStdio(serverConfig).catch((error: unknown) => {
  console.error('Failed to start stdio server:', error);
  process.exit(1);
});
