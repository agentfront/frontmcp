// The e2e config in local auth mode, where each caller connects their own billing account at sign-in (e2e/caller-credentials.e2e.spec.ts).
import { FrontMcp } from '@frontmcp/sdk';

import { serverConfig, skilledOpenApiPlugin } from './config';

const port = parseInt(process.env['PORT'] ?? '3107', 10);

// `FrontMcpMetadata` is not exported from the SDK barrel; the decorator's parameter type stands in for it.
type FrontMcpInput = Parameters<typeof FrontMcp>[0];

@FrontMcp({
  ...serverConfig,
  // The bundle's billing binding sends the token the caller connected as "billing", never the server's own.
  plugins: [skilledOpenApiPlugin({ authProviders: { 'billing-token': 'billing' } })],
  http: { port },
  auth: {
    mode: 'local',
    // The e2e specs sign in with a client id that isn't registered.
    requireRegisteredClients: false,
    allowDefaultPublic: false,
    login: {
      title: 'Sign in to billing',
      fields: {
        user: { type: 'text', label: 'User', required: true },
        billingToken: { type: 'password', label: 'Billing API token' },
      },
      subject: { fromField: 'user', strategy: 'per-account' },
    },
    // A caller who gives a billing token connects it, in the session credential vault, as "billing".
    authenticate: async ({ fields }: { fields: Record<string, string> }) => {
      const billingToken = fields['billingToken'];
      return { ok: true, credentials: billingToken ? [{ key: 'billing', secret: billingToken }] : [] };
    },
  },
} as unknown as FrontMcpInput)
export default class CallerCredentialsServer {}
