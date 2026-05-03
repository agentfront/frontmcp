// file: apps/demo/src/skilled-openapi-fixtures/skilled-openapi-demo.app.ts
//
// Self-contained demo entry for `@frontmcp/plugin-skilled-openapi`.
//
// Run with:
//   tsx apps/demo/src/skilled-openapi-fixtures/skilled-openapi-demo.app.ts
//
// What it does:
//   1. Boots a mock REST server on :9876 that pretends to be a "billing" API
//   2. Boots a FrontMCP server on :3010 with `SkilledOpenApiPlugin` configured
//      to load `billing-bundle.json` from disk (static source, dev mode so we
//      skip signature verification for the demo)
//   3. The MCP client only sees `search_skill`, `load_skill`, `execute_action`
//      — the three OpenAPI operations are HIDDEN behind the `invoices` skill.
//
// Suggested verification flow:
//   - Connect MCP Inspector to http://localhost:3010
//   - tools/list → expect [search_skill, load_skill, execute_action]
//   - search_skill({ query: "create invoice" }) → returns the `invoices` skill
//   - load_skill({ skillId: "invoices" }) → instructions + 3 actions w/ schemas
//   - execute_action({ skillId: "invoices", actionId: "createInvoice",
//       input: { customerId: "cus_1", amount: 4200 } })
//     → mock server logs the hit, returns { id: "inv_1", status: "open" }

import * as path from 'node:path';

import SkilledOpenApiPlugin from '@frontmcp/plugin-skilled-openapi';
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { startMockBillingServer } from './mock-rest-server';

const bundlePath = path.resolve(__dirname, 'billing-bundle.json');

@FrontMcp({
  info: { name: 'Skilled-OpenAPI Demo 🚀', version: '0.1.0' },
  apps: [],
  plugins: [
    SkilledOpenApiPlugin.init({
      source: { type: 'static', path: bundlePath, watch: false },
      // Demo mode: bypass signature verification + allow http: outbound to the
      // mock REST server. NEVER set dev=true in production.
      dev: true,
      requireSignature: false,
      trustedKeys: [],
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
  logging: { level: LogLevel.Verbose },
  http: { port: 3010 },
  observability: { logging: true, requestLogs: true },
})
export class SkilledOpenApiDemoApp {}

if (require.main === module) {
  // Start mock REST first so the plugin's first pull / first execute_action
  // sees a live upstream.
  startMockBillingServer(Number(process.env['MOCK_BILLING_PORT'] ?? 9876));
  // The decorator wires the FrontMCP server; importing this module starts it.

  console.log('[skilled-openapi-demo] mock REST + FrontMCP wired. Connect MCP client to http://localhost:3010');
}
