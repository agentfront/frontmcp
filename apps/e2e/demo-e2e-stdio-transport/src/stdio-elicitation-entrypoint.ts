import { FrontMcpInstance } from '@frontmcp/sdk';

import { serverConfig } from './config.js';

FrontMcpInstance.runStdio({ ...serverConfig, elicitation: { enabled: true } }).catch((err) => {
  console.error('Failed to start stdio server:', err);
  process.exit(1);
});
