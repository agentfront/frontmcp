/**
 * E2E proving PER-APP custom-auth-UI scoping (#469 follow-up — map form: esm.sh
 * import-map + server-side transform).
 *
 * The server runs with `splitByApp: true` and a SINGLE app that declares its OWN
 * local auth + `auth.ui: { login: './login.tsx' }` + `auth.extras: { 'envs:add': fn }`
 * under `@App({ auth: { ui, extras } })` — there is NO top-level auth UI
 * anywhere. Because each split-app scope builds its own AuthUiRegistry from its
 * own resolved auth options, the app's extras endpoint is wired and routes its
 * handler.
 *
 * The custom-login PAGE rendering (inline transformed module + esm.sh
 * import-map + injected state) is asserted in full by the non-split
 * `local-auth-ui.e2e.spec.ts`; here we prove the per-app REGISTRY is built and
 * wired (the extra endpoint distinguishes a configured registry from none) and
 * that the old per-slot bundle route is gone (the module is inlined now).
 */
import { expect, TestServer } from '@frontmcp/testing';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.auth-ui-split.ts';

async function postExtra(baseUrl: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}/oauth/ui/extra`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

describe('LOCAL-mode auth E2E — PER-APP auth.ui under splitByApp (#469)', () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      debug: process.env['DEBUG'] === '1',
    });
    baseUrl = server.info.baseUrl;
  }, 90000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  it("builds the split app's OWN auth-UI registry and wires its extras endpoint", async () => {
    // The extra endpoint resolves the per-app registry built from
    // `@App({ auth: { extras: { 'envs:add': fn } } })`. A configured-but-unmatched
    // extra returns 400 "Unknown extra" (registry exists); a server with NO
    // registry would instead 404 "No extras are configured." So 400 here proves
    // the split app built its own registry (there is no top-level auth UI).
    const res = await postExtra(baseUrl, { action: 'not_a_real_extra', pending_auth_id: 'x', csrf: 'y' });
    expect(res.status).toBe(400);
    const j = (await res.json()) as { ok: boolean; error?: string };
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/unknown extra/i);
  });

  it('does NOT serve a separate per-slot bundle route (the module is inlined now)', async () => {
    // The old `/oauth/ui/:slot.js` IIFE route is gone in the transform model.
    const res = await fetch(`${baseUrl}/oauth/ui/login.js`, { method: 'GET' });
    expect(res.status).toBe(404);
  });
});
