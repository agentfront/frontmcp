// The e2e config with the plugin and its credential resolver in an @App, none on the server (e2e/app-resolver.e2e.spec.ts).
import { App, FrontMcp } from '@frontmcp/sdk';

import { environmentCredentialResolver, serverConfig, skilledOpenApiPlugin } from './config';

const port = parseInt(process.env['PORT'] ?? '3107', 10);

// `FrontMcpMetadata` is not exported from the SDK barrel; the decorator's parameter type stands in for it.
type FrontMcpInput = Parameters<typeof FrontMcp>[0];

@App({ name: 'billing', plugins: [skilledOpenApiPlugin()], providers: [environmentCredentialResolver] })
class BillingApp {}

@FrontMcp({
  ...serverConfig,
  apps: [BillingApp],
  plugins: [],
  providers: [],
  http: { port },
} as unknown as FrontMcpInput)
export default class AppResolverServer {}
