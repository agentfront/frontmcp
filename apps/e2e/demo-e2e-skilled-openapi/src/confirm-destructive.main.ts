// The e2e config with DELETE actions asking the user first, through an MCP elicitation (e2e/confirm-destructive.e2e.spec.ts).
import { FrontMcp } from '@frontmcp/sdk';

import { serverConfig, skilledOpenApiPlugin } from './config';

const port = parseInt(process.env['PORT'] ?? '3107', 10);

// `FrontMcpMetadata` is not exported from the SDK barrel; the decorator's parameter type stands in for it.
type FrontMcpInput = Parameters<typeof FrontMcp>[0];

@FrontMcp({
  ...serverConfig,
  plugins: [skilledOpenApiPlugin({ confirm: { methods: ['DELETE'] } })],
  elicitation: { enabled: true },
  http: { port },
} as unknown as FrontMcpInput)
export default class ConfirmDestructiveServer {}
