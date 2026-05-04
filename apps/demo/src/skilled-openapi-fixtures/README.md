# skilled-openapi demo

Self-contained, runnable verification harness for `@frontmcp/plugin-skilled-openapi`.

## Files

- `billing-bundle.json` — fixture skill bundle (one `invoices` skill bundling 3 hidden operations against a mock billing service).
- `mock-rest-server.ts` — tiny http server that answers the three operations with deterministic responses; runs on `:9876`.
- `skilled-openapi-demo.app.ts` — boots the mock REST server **and** a FrontMCP server (`:3010`) with `SkilledOpenApiPlugin` configured against the fixture.

## Run

```bash
yarn tsx apps/demo/src/skilled-openapi-fixtures/skilled-openapi-demo.app.ts
```

## Manual checks

1. `tools/list` returns exactly: `search_skill`, `load_skill`, `execute_action`. The three OpenAPI operations (`createInvoice`, `getInvoice`, `refundInvoice`) MUST NOT appear.
2. `skills://catalog` lists the `invoices` skill with `bundleVersion: "1.0.0"`.
3. `search_skill({ query: "create invoice" })` returns `[{ skillId: "invoices", ... }]`.
4. `load_skill({ skillId: "invoices" })` returns instructions plus 3 actions with their JSON Schemas.
5. `execute_action({ skillId: "invoices", actionId: "createInvoice", input: { customerId: "cus_1", amount: 4200 } })` →
   - Mock REST server logs a `POST /v1/invoices` hit (with `Authorization: Bearer demo-billing-token`).
   - Tool returns `{ ok: true, status: 201, data: { id: "inv_1", status: "open" } }`.
6. Edit `billing-bundle.json` (e.g. tweak the instructions text), bump `version`, and the hot-swap path replays through `BundleSyncService` (when `watch: true` is set on the static source).

## Caveats

- `dev: true` and `requireSignature: false` are set so the demo doesn't require a signing keypair. **Never use these settings in production.**
- The `vaultRef: "demo-billing-token"` reference resolves to `undefined` in the in-memory credential resolver because no value is configured — `execute_action` will fail with `auth resolution failed` until you wire a credential. To exercise the full path, edit `skilled-openapi-demo.app.ts` to seed the `MemoryCredentialResolver` with `{ "demo-billing-token": "demo-bearer" }`.
