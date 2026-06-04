/**
 * Unit tests for auth-UI page assembly (#469 — esm.sh import-map + server-side
 * transform). Asserts the THREE pillars of the new model on the assembled page:
 *
 *  1. an inline `<script type="module">` containing the TRANSPILED tsx (JSX →
 *     React.createElement, no `bundle:true`/IIFE) + the `mountAuthPage` import;
 *  2. a `<script type="importmap">` mapping `react` + `@frontmcp/ui/auth` to
 *     esm.sh, with `?external=react` on the `@frontmcp/*` URL (single React);
 *  3. the injected `window.__FRONTMCP_AUTH__` state.
 *
 * It also asserts the page does NOT SSR / bundle: no `react-dom/server`, no IIFE
 * marker, and React itself is not inlined (only mapped via the import-map).
 *
 * The transform runs the REAL esbuild path against a tiny temp `.tsx`; the
 * registry exposes only the slot source + resolver overrides the assembler uses.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AUTH_FLOW_GLOBAL_KEY, type AuthFlowState, type AuthUiFileSource } from '../auth-ui.contract';
import { type AuthUiRegistry } from '../auth-ui.registry';
import { AUTH_MOUNT_ID, authUiExtraPath, authUiSecurityHeaders, buildAuthUiPage } from '../auth-ui.render';

const COMPONENT = `
import React from 'react';
import { useAuthFlow } from '@frontmcp/ui/auth';

export default function CustomLogin() {
  const { state } = useAuthFlow();
  return React.createElement('h1', { 'data-testid': 'custom-login-root' }, 'Custom Branded Sign In ' + state.clientId);
}
`;

let dir: string;
let file: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'authui-render-'));
  file = join(dir, 'login.tsx');
  writeFileSync(file, COMPONENT, 'utf-8');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Minimal stub of the registry surface buildAuthUiPage uses. */
function stubRegistry(opts: {
  source?: AuthUiFileSource | undefined;
  overrides?: Record<string, string>;
}): AuthUiRegistry {
  return {
    getSlotSource: () => opts.source,
    getResolverOverrides: () => opts.overrides,
    recordSlotError: () => undefined,
  } as unknown as AuthUiRegistry;
}

const baseState: AuthFlowState = {
  slot: 'login',
  pendingAuthId: 'pid-1',
  clientId: 'client-1',
  csrfToken: 'csrf-xyz',
  submitUrl: '/mcp/oauth/callback',
};

describe('buildAuthUiPage', () => {
  it('returns undefined when the slot has no file source (fall back to built-in)', () => {
    const page = buildAuthUiPage({
      registry: stubRegistry({ source: undefined }),
      slot: 'login',
      state: baseState,
      fullPath: '/mcp',
    });
    expect(page).toBeUndefined();
  });

  it('injects the serialized state to the contract global', () => {
    const page = buildAuthUiPage({
      registry: stubRegistry({ source: { file } }),
      slot: 'login',
      state: baseState,
      fullPath: '/mcp',
    });
    expect(page).toBeDefined();
    expect(page!.html).toContain(`window["${AUTH_FLOW_GLOBAL_KEY}"]`);
    expect(page!.html).toContain('"csrfToken":"csrf-xyz"');
    expect(page!.html).toContain('"pendingAuthId":"pid-1"');
  });

  it('ships an EMPTY mount node (no server-rendered component markup)', () => {
    const page = buildAuthUiPage({
      registry: stubRegistry({ source: { file } }),
      slot: 'login',
      state: baseState,
      fullPath: '/mcp',
    });
    // The mount node carries only a <noscript> notice — no SSR'd component.
    expect(page!.html).toContain(`<div id="${AUTH_MOUNT_ID}"><noscript>`);
    expect(page!.html).toContain('requires JavaScript');
    // The component's markup-producing call is in the inline MODULE (it runs in
    // the browser), but the literal rendered <h1> text is NOT pre-rendered.
    expect(page!.html).not.toMatch(/<h1[^>]*>Custom Branded Sign In/);
  });

  it('inlines a <script type="module"> with the TRANSPILED tsx + mountAuthPage import (no bundling/SSR)', () => {
    const page = buildAuthUiPage({
      registry: stubRegistry({ source: { file } }),
      slot: 'login',
      state: baseState,
      fullPath: '/mcp',
    });
    const html = page!.html;
    // The inline module is present and is a TRANSFORM (JSX → createElement), not a bundle.
    expect(html).toContain('<script type="module">');
    expect(html).toContain('React.createElement');
    // The transpiled source preserves the component identifier + bare imports.
    expect(html).toContain('CustomLogin');
    expect(html).toMatch(/import\s*\{[^}]*useAuthFlow[^}]*\}\s*from\s*["']@frontmcp\/ui\/auth["']/);
    // The mount tail imports mountAuthPage from @frontmcp/ui/auth and calls it.
    expect(html).toMatch(/import\s*\{[^}]*mountAuthPage[^}]*\}\s*from\s*["']@frontmcp\/ui\/auth["']/);
    expect(html).toMatch(/mountAuthPage[\s\S]*\(\s*CustomLogin\s*\)/i);
    // NOT a bundle / SSR: no IIFE wrapper marker, no server renderer, React not inlined.
    expect(html).not.toContain('react-dom/server');
    expect(html).not.toContain('renderToString');
    expect(html).not.toContain('(function()'); // no IIFE
    // React is loaded via the import-map, not inlined into the page.
    expect(html).not.toContain('React.Component'); // a bundled react would carry its internals
  });

  it('emits a <script type="importmap"> mapping react + @frontmcp/ui/auth → esm.sh with ?external=react (no @frontmcp/uipack/auth)', () => {
    const page = buildAuthUiPage({
      registry: stubRegistry({ source: { file } }),
      slot: 'login',
      state: baseState,
      fullPath: '/mcp',
    });
    const html = page!.html;
    expect(html).toContain('<script type="importmap">');
    // react resolves to esm.sh and is NOT externalized against itself.
    expect(html).toMatch(/"react":\s*"https:\/\/esm\.sh\/react/);
    expect(html).not.toMatch(/"react":\s*"[^"]*external=react/);
    // The @frontmcp/ui/auth specifier resolves to esm.sh and carries
    // ?external=react,react-dom so the whole page shares ONE React instance.
    expect(html).toMatch(/"@frontmcp\/ui\/auth":\s*"https:\/\/esm\.sh\/@frontmcp\/ui\/auth[^"]*external=react/);
    // The contract now lives in @frontmcp/ui/auth — the page never references
    // the removed @frontmcp/uipack/auth subpath.
    expect(html).not.toContain('@frontmcp/uipack/auth');
    // react-dom/client (used by createRoot in mountAuthPage) is mapped.
    expect(html).toMatch(/"react-dom\/client":\s*"https:\/\/esm\.sh\/react-dom/);
  });

  it('honors resolverOverrides (local dev / offline mapping for @frontmcp/* specifiers)', () => {
    const page = buildAuthUiPage({
      registry: stubRegistry({
        source: { file },
        overrides: { '@frontmcp/ui/auth': 'http://localhost:5173/ui-auth.mjs' },
      }),
      slot: 'login',
      state: baseState,
      fullPath: '/mcp',
    });
    const html = page!.html;
    expect(html).toContain('"@frontmcp/ui/auth": "http://localhost:5173/ui-auth.mjs"');
    // A locally-overridden (non-esm.sh) URL is NOT externalized.
    expect(html).not.toMatch(/localhost:5173\/ui-auth\.mjs[^"]*external=react/);
  });

  it('returns CSP + anti-clickjacking headers allowing esm.sh (no unsafe-eval)', () => {
    const page = buildAuthUiPage({
      registry: stubRegistry({ source: { file } }),
      slot: 'login',
      state: baseState,
      fullPath: '/mcp',
    });
    const csp = page!.headers['Content-Security-Policy'];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('https://esm.sh');
    expect(csp).not.toContain("'unsafe-eval'");
    expect(page!.headers['X-Frame-Options']).toBe('DENY');
    expect(page!.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('records the slot error + falls back when the source file is missing', () => {
    const recorded: string[] = [];
    const reg = {
      getSlotSource: () => ({ file: join(dir, 'does-not-exist.tsx') }) as AuthUiFileSource,
      getResolverOverrides: () => undefined,
      recordSlotError: (_slot: unknown, msg: string) => recorded.push(msg),
    } as unknown as AuthUiRegistry;
    const page = buildAuthUiPage({ registry: reg, slot: 'login', state: baseState, fullPath: '/mcp' });
    expect(page).toBeUndefined();
    expect(recorded.length).toBe(1);
    // uipack surfaces a raw ENOENT for an absolute missing path; the slot is
    // recorded as errored so it falls back to the built-in page.
    expect(recorded[0]).toMatch(/ENOENT|not found/i);
  });

  it('escapes a script-close sequence in the injected state (no </script> breakout)', () => {
    const evil: AuthFlowState = { ...baseState, error: '</script><script>alert(1)</script>' };
    const page = buildAuthUiPage({
      registry: stubRegistry({ source: { file } }),
      slot: 'error',
      state: evil,
      fullPath: '/mcp',
    });
    expect(page!.html).not.toContain('</script><script>alert(1)</script>');
    expect(page!.html).toContain('<\\/script>');
  });
});

describe('auth-UI path + header helpers', () => {
  it('builds the extra path under the scope path', () => {
    expect(authUiExtraPath('/mcp')).toBe('/mcp/oauth/ui/extra');
  });

  it('security headers include the expected directives', () => {
    const h = authUiSecurityHeaders();
    expect(h['Content-Security-Policy']).toContain("default-src 'self'");
    expect(h['Content-Security-Policy']).toContain("form-action 'self'");
    expect(h['Content-Security-Policy']).toContain("script-src 'self' 'unsafe-inline' https://esm.sh");
    expect(h['Referrer-Policy']).toBe('no-referrer');
  });
});
