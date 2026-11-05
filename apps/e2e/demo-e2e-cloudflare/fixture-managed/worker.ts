// A managed Worker set up as in production; the e2e makes its token, signing key and API credential at start.
import 'reflect-metadata';

import { env } from 'cloudflare:workers';

import { createEdgeMcp, kvBundleCacheFromEnv } from '@frontmcp/edge';

interface ManagedFixtureBindings {
  BUNDLE_PULL_TOKEN: string;
  BUNDLE_TRUSTED_KEY: string;
  BILLING_API_TOKEN: string;
}

const bindings = env as unknown as ManagedFixtureBindings;

const mcp = createEdgeMcp({
  info: { name: 'cf-managed-fixture', version: '1.0.0' },
  apps: [],
  http: { entryPath: '/mcp' },
  health: { readyz: { enabled: true }, includeDetails: true },
  tasks: { enabled: false },
  managed: {
    endpoint: 'https://bundles.example/v1/bundles/e2e-managed',
    authToken: bindings.BUNDLE_PULL_TOKEN,
    expectedAudience: 'e2e:managed',
    jwksUrl: 'https://bundles.example/.well-known/jwks.json',
    expectedIssuer: 'https://bundles.example',
    trustedKeys: [JSON.parse(bindings.BUNDLE_TRUSTED_KEY)],
    credentials: { 'billing-token': bindings.BILLING_API_TOKEN },
    enableWebhook: true,
    cache: kvBundleCacheFromEnv('BUNDLE_CACHE'),
  },
});

export default mcp;
export const FrontMcpPushReplay = mcp.PushReplayDurableObject;
