import { FrontMcpInstance } from '@frontmcp/sdk';

import { serverConfig } from './config';

// `FrontMcpConfigInput` is not exported from the SDK barrel; `runStdio`'s parameter type stands in for it.
type RunStdioInput = Parameters<typeof FrontMcpInstance.runStdio>[0];

FrontMcpInstance.runStdio(serverConfig as unknown as RunStdioInput).catch((error: unknown) => {
  // stdout carries the JSON-RPC frames.
  console.error('[stdio-entrypoint] failed to start:', error);
  process.exit(1);
});
