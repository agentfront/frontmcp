// file: apps/e2e/demo-e2e-skilled-openapi/src/main.ts
//
// FrontMCP server for the e2e harness. Boots:
//   1. The mock REST server on :9876 (so SkilledOpenApiPlugin's outbound calls
//      have a real upstream to hit during execute_action tests)
//   2. The plugin configured with a static-source bundle from src/fixtures/
//      and dev=true so signature checks are bypassed for the test bundle
//
// The MCP server listens on $PORT (default 3107).

import * as path from 'node:path';

import SkilledOpenApiPlugin from '@frontmcp/plugin-skilled-openapi';
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { startMockBillingServer } from './mock-rest-server';

const port = parseInt(process.env['PORT'] ?? '3107', 10);
const mockPort = parseInt(process.env['MOCK_BILLING_PORT'] ?? '9876', 10);

// Start the mock REST upstream BEFORE the FrontMCP server boots so the
// plugin's first poll has something to talk to.
void startMockBillingServer(mockPort);

const bundlePath = path.resolve(__dirname, 'fixtures/billing-bundle.json');

@FrontMcp({
  info: { name: 'Demo E2E Skilled-OpenAPI', version: '0.1.0' },
  apps: [],
  plugins: [
    SkilledOpenApiPlugin.init({
      source: { type: 'static', path: bundlePath, watch: false },
      dev: true,
      requireSignature: false,
      trustedKeys: [],
      credentials: { 'billing-token': 'demo-bearer-xyz' },
      outbound: {
        allowHttp: true,
        allowPrivateNetworks: true,
        defaultTimeoutMs: 5_000,
        defaultMaxResponseBytes: 256 * 1024,
        maxConcurrencyPerHost: 10,
      },
      sourceConflictPolicy: 'static-wins',
    }),
  ],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}
