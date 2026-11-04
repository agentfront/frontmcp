// The e2e config with the plugin installed twice, which must refuse to start (e2e/plugin-registration.e2e.spec.ts).
import { FrontMcp } from '@frontmcp/sdk';

import { serverConfig, skilledOpenApiPlugin } from './config';

const port = parseInt(process.env['PORT'] ?? '3107', 10);

// `FrontMcpMetadata` is not exported from the SDK barrel; the decorator's parameter type stands in for it.
type FrontMcpInput = Parameters<typeof FrontMcp>[0];

@FrontMcp({
  ...serverConfig,
  plugins: [skilledOpenApiPlugin(), skilledOpenApiPlugin()],
  http: { port },
} as unknown as FrontMcpInput)
export default class TwoPluginsServer {}
