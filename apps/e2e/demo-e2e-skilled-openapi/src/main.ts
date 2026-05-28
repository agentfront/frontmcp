// file: apps/e2e/demo-e2e-skilled-openapi/src/main.ts
//
// HTTP entrypoint for the skilled-openapi e2e harness. Boots:
//   1. The mock REST server on :9876 (so SkilledOpenApiPlugin's outbound
//      calls have a real upstream to hit during execute_action tests)
//   2. A FrontMCP server with the shared `serverConfig` + the HTTP port
//      — streamable HTTP transport on $PORT (default 3107).
//
// For the stdio variant, see `./stdio-entrypoint.ts`. Both entrypoints
// consume `serverConfig` from `./config` so a behavioural difference
// between transports requires an explicit edit in that file.

import { FrontMcp } from '@frontmcp/sdk';

import { serverConfig } from './config';
import { startMockBillingServer } from './mock-rest-server';

const port = parseInt(process.env['PORT'] ?? '3107', 10);
const mockPort = parseInt(process.env['MOCK_BILLING_PORT'] ?? '9876', 10);

// Start the mock REST upstream BEFORE the FrontMCP server boots so the
// plugin's first poll has something to talk to.
void startMockBillingServer(mockPort);

// Cast through the decorator's own parameter type. `FrontMcpMetadata` is
// a discriminated union on `splitByApp` and isn't re-exported from the
// SDK barrel; extracting the param type avoids a deep import while still
// being type-checked against the decorator's contract. The Zod schema
// underneath validates the actual shape at runtime.
type FrontMcpInput = Parameters<typeof FrontMcp>[0];

// Merge any pre-existing `http` block from `serverConfig` instead of
// replacing it wholesale with `{ port }`. Today `serverConfig` declares no
// `http` field (the shared config is transport-agnostic), so this is a
// no-op at runtime — but the merge is cheap and protects against a future
// edit that adds nested HTTP options (TLS, host, body limits) only to
// have them silently dropped by this entrypoint.
const baseHttp = (serverConfig as { http?: Record<string, unknown> }).http ?? {};

@FrontMcp({ ...serverConfig, http: { ...baseHttp, port } } as unknown as FrontMcpInput)
export default class Server {}
