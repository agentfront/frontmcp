/**
 * Auth-UI page assembly (#469 — esm.sh import-map + server-side transform,
 * routed through `@frontmcp/uipack`'s pluggable `renderComponent`).
 *
 * Given an {@link AuthFlowState} and a registered {@link AuthUiRegistry}, this
 * resolves the slot's `.tsx` FileSource and hands it to uipack's GENERIC
 * `renderComponent` with:
 *  - `transformOnly: true` — single-file esbuild transform (deps stay external,
 *    NO bundling, NO server-side React);
 *  - a {@link ShellMountDescriptor} (`mount`) whose tail imports `mountAuthPage`
 *    from `@frontmcp/ui/auth` and renders into an empty `#frontmcp-auth-root`;
 *  - a {@link ShellDataInjectionDescriptor} (`dataInjection`) that seeds
 *    `window.__FRONTMCP_AUTH__` with the (XSS-escaped) flow state.
 *
 * uipack itself contains ZERO auth-specific code — the auth specifics (the
 * injected global key, the `@frontmcp/ui/auth` mount specifier + tail, the auth
 * CSP) live HERE in the SDK and are passed in as plain data/strings.
 * `@frontmcp/ui/auth` is a STRING the SDK passes to uipack; neither uipack nor
 * the SDK imports `@frontmcp/ui`.
 *
 * The page contains, in order: the `<script type="importmap">` (react /
 * react-dom / `@frontmcp/ui/auth` → esm.sh, the `@frontmcp/*` ones carrying
 * `?external=react,react-dom` for a single React), the injected
 * `window.__FRONTMCP_AUTH__` state `<script>`, an EMPTY `#frontmcp-auth-root`
 * mount node, and the inline transformed module + the `mountAuthPage` tail. The
 * server OWNS the CSRF token (already in `state.csrfToken`) and the security
 * headers (CSP + anti-clickjacking) returned alongside the HTML. No PII is
 * embedded — `state` carries only OAuth client identifiers + control fields.
 *
 * ## Local-dev / offline caveat
 *
 * `@frontmcp/ui/auth` is NOT on esm.sh inside this monorepo, so an in-browser
 * render needs it either published to npm or mapped to a locally-served URL via
 * the registry's resolver overrides. The shell (import-map → esm.sh, injected
 * state, inline transformed module) is produced regardless — which is what the
 * HTTP e2e asserts; only the actual browser DOM render depends on the specifier
 * being reachable.
 *
 * @packageDocumentation
 */
import {
  createResolverWithOverrides,
  renderComponent,
  type ShellConfig,
  type ShellMountDescriptor,
} from '@frontmcp/uipack';

import { AUTH_FLOW_GLOBAL_KEY, AUTH_MOUNT_ID, type AuthFlowState, type AuthSlot } from './auth-ui.contract';
import { type AuthUiRegistry } from './auth-ui.registry';

/**
 * The mount id the client renders into. Re-exported from the server-owned
 * contract so the shell and (via the wire contract) the `@frontmcp/ui/auth`
 * client mount agree on a single value.
 */
export { AUTH_MOUNT_ID };

/** Path the auth extra submissions POST to (action discriminates the extra). */
export function authUiExtraPath(fullPath: string): string {
  return `${fullPath}/oauth/ui/extra`;
}

/**
 * The Content-Security-Policy for an auth-UI page.
 *
 * Allows `https://esm.sh` for module scripts + connections + styles (the
 * import-map resolves every dependency there) and `'unsafe-inline'` for scripts
 * (only the server-controlled, JSON-escaped state `<script>` is inline; never
 * user input). It does NOT include `'unsafe-eval'` — the TSX→JS transform is
 * done server-side, so the browser never evals source. Framing is denied to
 * prevent clickjacking of the login / consent form.
 */
export const AUTH_UI_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://esm.sh",
  "connect-src 'self' https://esm.sh",
  "style-src 'self' 'unsafe-inline' https://esm.sh",
  "img-src 'self' data: https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Build the auth security headers for an auth-UI page (CSP + anti-clickjacking).
 *
 * @param csp - Override the CSP value (defaults to {@link AUTH_UI_CSP}).
 */
export function authUiPageHeaders(csp: string = AUTH_UI_CSP): Record<string, string> {
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

/** Convenience wrapper used by the OAuth flows. Same as `authUiPageHeaders()`. */
export function authUiSecurityHeaders(): Record<string, string> {
  return authUiPageHeaders(AUTH_UI_CSP);
}

/**
 * The auth mount tail: imports `mountAuthPage` from `@frontmcp/ui/auth` and
 * renders the developer's default-exported component into `#frontmcp-auth-root`.
 * `@frontmcp/ui/auth` is just a STRING here — the SDK never imports it.
 */
function authMountDescriptor(): ShellMountDescriptor {
  return {
    moduleSpecifier: '@frontmcp/ui/auth',
    generate: (exportName) =>
      `\nimport { mountAuthPage as __mountAuthPage } from '@frontmcp/ui/auth';\n__mountAuthPage(${exportName});`,
    mountNodeId: AUTH_MOUNT_ID,
    mountNodeInnerHtml: '<noscript>This authorization page requires JavaScript.</noscript>',
  };
}

/**
 * Build the complete auth-UI HTML page for a slot.
 *
 * Returns `undefined` when the registry has no file for the slot — the caller
 * then renders the built-in page (defaults preserved). On a transform/read
 * failure the error is cached on the registry (so a broken file isn't
 * re-transpiled every request) and `undefined` is returned (fallback).
 */
export function buildAuthUiPage(options: {
  registry: AuthUiRegistry;
  slot: AuthSlot;
  state: AuthFlowState;
  fullPath: string;
  /** Page <title> (defaults to a slot-appropriate label). */
  title?: string;
}): { html: string; headers: Record<string, string> } | undefined {
  const { registry, slot, state } = options;
  const source = registry.getSlotSource(slot);
  if (!source) return undefined; // no file registered → fall back to built-in

  try {
    const overrides = registry.getResolverOverrides();
    const shellConfig: ShellConfig = {
      // `toolName` is only used by the default widget data-injection, which we
      // override below; a stable label keeps logs/debugging sane.
      toolName: 'auth-ui',
      withShell: true,
      // Auth pages drive the OAuth flow via @frontmcp/ui/auth, NOT the widget
      // bridge IIFE (which references `window.__mcp*`).
      includeBridge: false,
      title: options.title ?? defaultTitle(slot),
      // <meta> CSP permits esm.sh + inline; the AUTHORITATIVE CSP is the HTTP
      // header returned below (AUTH_UI_CSP, no 'unsafe-eval').
      csp: { connectDomains: ['https://esm.sh'], resourceDomains: ['https://esm.sh'] },
      // Pluggable mount tail (mountAuthPage from @frontmcp/ui/auth) + the empty
      // #frontmcp-auth-root mount node.
      mount: authMountDescriptor(),
      // Inject the flow state under window.__FRONTMCP_AUTH__ (XSS-escaped by uipack).
      dataInjection: { globalKey: AUTH_FLOW_GLOBAL_KEY, value: state },
      // Local-dev / offline: map @frontmcp/ui/auth (not on esm.sh in a monorepo)
      // to a served URL when configured.
      ...(overrides ? { resolver: createResolverWithOverrides(overrides) } : {}),
    };

    const result = renderComponent(
      // TRANSFORM-ONLY: single-file transpile, deps external, no widget mount.
      { source: { file: source.file }, transformOnly: true },
      shellConfig,
    );

    return { html: result.html, headers: authUiPageHeaders() };
  } catch (err) {
    registry.recordSlotError(slot, err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

function defaultTitle(slot: AuthSlot): string {
  switch (slot) {
    case 'login':
      return 'Sign In';
    case 'consent':
      return 'Authorize Access';
    case 'incremental':
      return 'Authorize Application';
    case 'federated':
      return 'Choose a Provider';
    case 'error':
      return 'Authorization Error';
    default:
      return 'Authorization';
  }
}
