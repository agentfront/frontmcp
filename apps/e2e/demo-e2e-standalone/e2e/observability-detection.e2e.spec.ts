/**
 * E2E regression for #453 — `@frontmcp/observability` detection.
 *
 * With `observability` config set and the package installed & resolvable, the
 * SDK must NOT warn that it "is not installed". Before the fix, the lazy
 * `require('@frontmcp/observability')` was wrapped in a catch-all that always
 * reported "not installed", even when `require()` threw for an unrelated reason
 * (an export-condition / transpile / peer mismatch under tsx + yarn) — so the
 * config was silently ignored and telemetry never activated.
 *
 * The test server runs under tsx (the issue's environment) where the package
 * resolves, so the misleading warning must never appear. If the module did fail
 * to load for some other reason, the SDK must say THAT accurately instead.
 */
import { expect, McpTestClient, test } from '@frontmcp/testing';

const NOT_INSTALLED = /@frontmcp\/observability is not installed/i;

test.describe('Observability detection (#453)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main-observability.ts',
    project: 'demo-e2e-standalone',
    publicMode: true,
  });

  test('server with observability config starts and serves', async ({ server }) => {
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      publicMode: true,
    }).buildAndConnect();

    expect(client.isConnected()).toBe(true);
    const tools = await client.tools.list();
    expect(tools).toContainTool('parent-hello');

    await client.disconnect();
  });

  test('does NOT falsely report @frontmcp/observability as not installed', async ({ server }) => {
    // Connect once so scope initialization (which runs the detection) has happened.
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      publicMode: true,
    }).buildAndConnect();
    await client.disconnect();

    const logs = server.getLogs().join('\n');

    // The package IS resolvable here, so the "not installed" warning is wrong.
    expect(logs).not.toMatch(NOT_INSTALLED);
  });

  test('actually activates @frontmcp/observability (telemetry enabled end-to-end)', async ({ server }) => {
    // Drive a request so the StructuredLogTransport emits at least one record.
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      publicMode: true,
    }).buildAndConnect();
    await client.tools.list();
    await client.disconnect();

    const logs = server.getLogs().join('\n');

    // The SDK's default logger prints human-readable lines; only
    // @frontmcp/observability's StructuredLogTransport emits OTel-shaped NDJSON
    // with `severity_number` + `trace_id`. Their presence proves the package was
    // detected, loaded, and wired — i.e. the config was honored, not silently
    // ignored behind a bogus "not installed". (This is the user-visible outcome
    // #453 is about; the not-installed-vs-load-failed classification itself is
    // unit-tested in libs/sdk/.../optional-dependency.util.spec.ts, since the
    // load-failure only reproduces under a specific tsx+yarn+published layout.)
    expect(logs).toMatch(/"severity_number":/);
    expect(logs).toMatch(/"trace_id":/);
  });
});
