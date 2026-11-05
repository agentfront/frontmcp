// The e2e server with a GitHub credential provider in its auth providers vault (e2e/auth-providers-vault.e2e.spec.ts).
import { FrontMcp } from '@frontmcp/sdk';

import { serverConfig } from './config';

const port = parseInt(process.env['PORT'] ?? '3119', 10);

@FrontMcp({
  ...serverConfig,
  http: { port },
  authProvidersVault: {
    providers: [
      {
        name: 'github',
        scope: 'global',
        loading: 'lazy',
        factory: async () => ({ type: 'bearer', token: 'github-e2e-token' }),
      },
    ],
  },
})
export default class AuthProvidersVaultServer {}
