// file: apps/e2e/demo-e2e-skilled-openapi/src/stdio-entrypoint.ts
//
// Stdio entrypoint for the skilled-openapi e2e harness. Runs the SAME
// FrontMCP config as `main.ts` but over JSON-RPC on stdin/stdout instead of
// streamable HTTP. Used by the cross-runtime parity spec to verify that
// `@frontmcp/plugin-skilled-openapi` produces identical MCP discovery
// output regardless of transport.
//
// Usage:
//   npx tsx src/stdio-entrypoint.ts
//
// The mock REST server is NOT booted here:
//   - For parity tests (discovery only), the plugin never reaches the
//     upstream — booting the mock would just collide with main.ts on
//     :9876 and the listen never resolves.
//   - For standalone stdio runs that need run_workflow action execution, set
//     MOCK_BILLING_PORT to a free port and start the mock in-process
//     before booting the FrontMCP server (mirror the pattern in main.ts).
// Keeping this entrypoint slim makes it usable from any future stdio test
// that wants to reuse the shared config without dragging the mock along.

import { FrontMcpInstance } from '@frontmcp/sdk';

import { serverConfig } from './config';

async function main(): Promise<void> {
  // Cast through `runStdio`'s parameter type. `FrontMcpConfigInput` isn't
  // re-exported from the SDK barrel; extracting the param type avoids a
  // deep import while keeping the call type-checked against the runtime
  // contract.
  type RunStdioInput = Parameters<typeof FrontMcpInstance.runStdio>[0];
  // Double-cast through `unknown` because the discriminated-union shape
  // (`FrontMcpMetadata`'s `splitByApp` branch) doesn't structurally overlap
  // with the literal inferred from `serverConfig`. Zod validates at boot.
  await FrontMcpInstance.runStdio(serverConfig as unknown as RunStdioInput);
}

main().catch((err) => {
  // Log to stderr — stdout is reserved for the JSON-RPC framing.
  console.error('[stdio-entrypoint] failed to start:', err);
  process.exit(1);
});
