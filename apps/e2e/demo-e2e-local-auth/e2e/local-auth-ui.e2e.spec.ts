/**
 * E2E for the custom auth-UI primitive (#469 — map form: esm.sh import-map +
 * server-side transform, routed through uipack's pluggable renderComponent).
 *
 * Drives `/oauth/authorize` against a server that declares
 * `auth.ui: { login: './…/login.tsx' }` + `auth.extras: { 'envs:add': fn }`,
 * asserting the inline-module + import-map + extra + CSRF wiring:
 *
 *   1. /oauth/authorize serves a page whose `<script type="module">` is the
 *      TRANSPILED component (server-side transform) + a `mountAuthPage` import,
 *      with an empty `#frontmcp-auth-root` mount and the injected
 *      `window.__FRONTMCP_AUTH__`. The component's RENDERED markup is NOT in the
 *      HTTP response (it renders in the browser).
 *   2. The page links its deps via a `<script type="importmap">` to esm.sh
 *      (react + `@frontmcp/ui/auth`, the latter with `?external=react`), and
 *      there is NO separately-served `/oauth/ui/login.js` bundle route (it 404s).
 *   3. POST /oauth/ui/extra routes to the auth.extras handler: a valid submit is
 *      accepted (and accumulates), an invalid one is rejected, and a bad CSRF is
 *      rejected 400.
 *   4. A no-JS login submit carrying the minted CSRF mints an authorization code;
 *      a mismatched CSRF is rejected 400.
 *
 * A real-browser DOM assertion is out of scope for an HTTP e2e (and the two
 * `@frontmcp/*` specifiers aren't on esm.sh in a monorepo) — the shell +
 * import-map + inline-module string checks are the contract this asserts.
 */
import { expect, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.auth-ui.ts';
const REDIRECT_URI = 'http://127.0.0.1:9876/callback';
const CLIENT_ID = 'auth-ui-test-client';

function makePkce(): { verifier: string; challenge: string } {
  const verifier = generateCodeVerifier();
  return { verifier, challenge: sha256Base64url(verifier) };
}

function buildAuthorizeUrl(baseUrl: string, challenge: string): string {
  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', 'read write');
  return url.toString();
}

/** GET /oauth/authorize → the custom-login page HTML + the injected state. */
async function startAuthorization(baseUrl: string, challenge: string) {
  const res = await fetch(buildAuthorizeUrl(baseUrl, challenge), { method: 'GET', redirect: 'manual' });
  expect(res.status).toBe(200);
  const html = await res.text();
  return { res, html };
}

/** Pull the injected `window.__FRONTMCP_AUTH__` state object out of the HTML. */
function extractInjectedState(html: string): Record<string, unknown> {
  const m = html.match(/window\["__FRONTMCP_AUTH__"\]\s*=\s*(\{.*?\});<\/script>/s);
  expect(m).toBeTruthy();
  return JSON.parse(m![1]) as Record<string, unknown>;
}

async function getCallback(baseUrl: string, params: Record<string, string>): Promise<Response> {
  const url = new URL(`${baseUrl}/oauth/callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetch(url.toString(), { method: 'GET', redirect: 'manual' });
}

async function postExtra(baseUrl: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}/oauth/ui/extra`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

describe('LOCAL-mode auth E2E — custom auth.ui / auth.extras (#469)', () => {
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

  // ===========================================================
  // Inline transformed module + import-map + injected global
  // ===========================================================
  describe('client-rendered login page (transform + import-map)', () => {
    it('inlines the TRANSPILED component as a module (no server-rendered markup, no bundle)', async () => {
      const { challenge } = makePkce();
      const { html } = await startAuthorization(baseUrl, challenge);
      // The component is rendered in the BROWSER, so its rendered <h1> markup is
      // NOT in the HTTP response — only an empty mount node.
      expect(html).toMatch(/<div id="frontmcp-auth-root"><noscript>[^<]*<\/noscript><\/div>/);
      expect(html).not.toMatch(/<h1[^>]*>Custom Branded Sign In/);
      // The built-in Tailwind login template markup is also NOT served.
      expect(html).not.toContain('text-3xl font-bold');
      // The inline module is a TRANSFORM (JSX → createElement), not a bundle/IIFE.
      expect(html).toContain('<script type="module">');
      expect(html).toContain('React.createElement');
      expect(html).toContain('CustomLoginPage');
      expect(html).not.toContain('react-dom/server');
      expect(html).not.toContain('renderToString');
      // The mount tail imports + calls mountAuthPage from @frontmcp/ui/auth.
      expect(html).toMatch(/import\s*\{[^}]*mountAuthPage[^}]*\}\s*from\s*["']@frontmcp\/ui\/auth["']/);
    });

    it('links dependencies via an esm.sh import-map with a single React', async () => {
      const { challenge } = makePkce();
      const { html } = await startAuthorization(baseUrl, challenge);
      expect(html).toContain('<script type="importmap">');
      // react resolves to esm.sh (not externalized against itself).
      expect(html).toMatch(/"react":\s*"https:\/\/esm\.sh\/react/);
      expect(html).not.toMatch(/"react":\s*"[^"]*external=react/);
      // @frontmcp/ui/auth resolves to esm.sh with ?external=react,react-dom (single React).
      expect(html).toMatch(/"@frontmcp\/ui\/auth":\s*"https:\/\/esm\.sh\/@frontmcp\/ui\/auth[^"]*external=react/);
      expect(html).toMatch(/"react-dom\/client":\s*"https:\/\/esm\.sh\/react-dom/);
    });

    it('injects window.__FRONTMCP_AUTH__ with the flow state (no PII)', async () => {
      const { challenge } = makePkce();
      const { html } = await startAuthorization(baseUrl, challenge);
      expect(html).toContain('window["__FRONTMCP_AUTH__"]');
      const state = extractInjectedState(html);
      expect(state['slot']).toBe('login');
      expect(state['clientId']).toBe(CLIENT_ID);
      expect(typeof state['csrfToken']).toBe('string');
      expect((state['csrfToken'] as string).length).toBeGreaterThan(10);
      expect(state['submitUrl']).toContain('/oauth/callback');
      expect(state['extraUrl']).toContain('/oauth/ui/extra');
      // No PII: there is no email/name field in the injected contract state.
      expect(state['email']).toBeUndefined();
      expect(state['name']).toBeUndefined();
    });

    it('sets the auth CSP headers (esm.sh allowed, no unsafe-eval) + anti-clickjacking', async () => {
      const { challenge } = makePkce();
      const { res } = await startAuthorization(baseUrl, challenge);
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain('https://esm.sh');
      expect(csp).not.toContain("'unsafe-eval'");
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    });

    it('does NOT serve a separate per-slot bundle route (the module is inlined now)', async () => {
      // The old `/oauth/ui/:slot.js` IIFE route is gone — the component is
      // inlined into the authorize page, so this path is not a served asset.
      const res = await fetch(`${baseUrl}/oauth/ui/login.js`, { method: 'GET' });
      expect(res.status).toBe(404);
    });
  });

  // ===========================================================
  // auth.extras routing + accumulator + CSRF
  // ===========================================================
  describe('auth.extras submit', () => {
    it('accepts a valid extra and accumulates it; reflects on the next render', async () => {
      const { challenge } = makePkce();
      const { html } = await startAuthorization(baseUrl, challenge);
      const state = extractInjectedState(html);
      const pendingAuthId = state['pendingAuthId'] as string;
      const csrf = state['csrfToken'] as string;

      const r1 = await postExtra(baseUrl, {
        action: 'envs:add',
        pending_auth_id: pendingAuthId,
        csrf,
        key: 'API_KEY',
        value: 'secret-1',
      });
      expect(r1.status).toBe(200);
      const j1 = (await r1.json()) as { ok: boolean; addedItems?: Record<string, unknown[]> };
      expect(j1.ok).toBe(true);
      expect(j1.addedItems?.['envs:add']).toEqual([{ key: 'API_KEY', value: 'secret-1' }]);

      // A second distinct add accumulates.
      const r2 = await postExtra(baseUrl, {
        action: 'envs:add',
        pending_auth_id: pendingAuthId,
        csrf,
        key: 'DB_URL',
        value: 'postgres://x',
      });
      const j2 = (await r2.json()) as { ok: boolean; addedItems?: Record<string, unknown[]> };
      expect(j2.ok).toBe(true);
      expect(j2.addedItems?.['envs:add']).toHaveLength(2);
    });

    it('rejects an invalid extra submission via the validator', async () => {
      const { challenge } = makePkce();
      const { html } = await startAuthorization(baseUrl, challenge);
      const state = extractInjectedState(html);
      const res = await postExtra(baseUrl, {
        action: 'envs:add',
        pending_auth_id: state['pendingAuthId'] as string,
        csrf: state['csrfToken'] as string,
        key: '', // invalid
      });
      expect(res.status).toBe(400);
      const j = (await res.json()) as { ok: boolean; error?: string };
      expect(j.ok).toBe(false);
      expect(j.error).toMatch(/key is required/);
    });

    it('rejects an extra with a bad CSRF token (400)', async () => {
      const { challenge } = makePkce();
      const { html } = await startAuthorization(baseUrl, challenge);
      const state = extractInjectedState(html);
      const res = await postExtra(baseUrl, {
        action: 'envs:add',
        pending_auth_id: state['pendingAuthId'] as string,
        csrf: 'totally-wrong-token',
        key: 'API_KEY',
      });
      expect(res.status).toBe(400);
      const j = (await res.json()) as { ok: boolean; error?: string };
      expect(j.ok).toBe(false);
      expect(j.error).toMatch(/csrf/i);
    });
  });

  // ===========================================================
  // CSRF gate on the login finish submit
  // ===========================================================
  describe('CSRF on callback', () => {
    it('rejects a login submit with a mismatched CSRF token (400)', async () => {
      const { challenge } = makePkce();
      const { html } = await startAuthorization(baseUrl, challenge);
      const state = extractInjectedState(html);
      const res = await getCallback(baseUrl, {
        pending_auth_id: state['pendingAuthId'] as string,
        email: 'user@test.local',
        csrf: 'wrong-csrf',
      });
      expect(res.status).toBe(400);
      expect((await res.text()).toLowerCase()).toContain('csrf');
    });

    it('mints an authorization code when the correct CSRF is echoed', async () => {
      const { challenge } = makePkce();
      const { html } = await startAuthorization(baseUrl, challenge);
      const state = extractInjectedState(html);
      const res = await getCallback(baseUrl, {
        pending_auth_id: state['pendingAuthId'] as string,
        email: 'user@test.local',
        csrf: state['csrfToken'] as string,
      });
      expect([302, 303]).toContain(res.status);
      const location = res.headers.get('location');
      expect(location).toBeTruthy();
      const code = new URL(location!).searchParams.get('code');
      expect(code).toBeTruthy();
    });
  });
});
