---
name: custom-auth-ui
description: Replace FrontMCP's built-in OAuth pages with custom React components using the auth.ui slot→file map and auth.extras name→handler map (no decorator, no class) plus the @frontmcp/ui/auth hooks.
---

# Custom Authorization UI (`auth.ui` / `auth.extras`)

FrontMCP's `local` and `remote` OAuth modes serve built-in HTML for the login, consent, incremental, federated, and error steps. The `auth.ui` **slot→file map** replaces any of those slots with **your own React component** while the framework keeps owning everything security-sensitive — CSRF, the Content-Security-Policy, anti-clickjacking headers, the pending-authorization state, the submit target, and the OAuth redirect. **You write only the UI.**

There is **no decorator and no class** — a slot is just a `.tsx` path, and an extra is just a handler function. If no `auth.ui` slot is configured, the built-in pages are served unchanged — the feature is purely additive and opt-in per slot.

## Two halves

| Half       | Package                                     | Responsibility                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server** | `@frontmcp/sdk` (`auth.ui` / `auth.extras`) | Transpiles your component's `.tsx` once (server-side, single-file transform — deps stay external), inlines it as an ES module + an import-map, injects the flow state, mints/verifies CSRF, sets CSP. It never bundles or renders your component server-side.                    |
| **Client** | `@frontmcp/ui/auth`                         | The framework-free contract (`AuthFlowState`, wire constants) **plus** hooks (`useAuthFlow`, …), `<AuthPageWrapper>`, and `mountAuthPage` that read the state, render the component in the browser, and drive submits. Loaded in the browser **from esm.sh** via the import-map. |

At request time the server serializes an `AuthFlowState` into `window.__FRONTMCP_AUTH__`, serves a page with an **empty** `#frontmcp-auth-root` mount node, an **`<script type="importmap">`** mapping `react` / `react-dom` / `@frontmcp/ui/auth` to **esm.sh** (the `@frontmcp/ui/auth` entry gets `?external=react,react-dom` for a single React), and an inline **`<script type="module">`** with your transpiled component + a `mountAuthPage(<YourComponent>)` tail. The browser loads the deps from esm.sh, runs the module, and `mountAuthPage` renders your component **client-side** into the empty node — there is **no bundling and no server-side React**, exactly how a `@Tool({ ui: { file } })` widget loads. `@frontmcp/ui` is browser-only — the SDK passes `@frontmcp/ui/auth` to the renderer only as an import-map specifier string and never imports it. Your component reads the state via the hooks and submits back to the OAuth callback.

## Server: `auth.ui` — a slot→file map

Map each slot to a sibling `.tsx`/`.jsx` source (default export); the SDK transpiles it once with esbuild and inlines it as an ES module (deps loaded from esm.sh via an import-map; `mountAuthPage` appended for you), exactly like a `@Tool({ ui: { file } })` widget. The path is **relative and auto-anchored to the config file's directory** — no `fileURLToPath`:

```ts
import { App } from '@frontmcp/sdk'; // or @FrontMcp

@App({
  auth: {
    mode: 'local',
    // slot → RELATIVE .tsx, auto-anchored to THIS config file's directory.
    ui: { login: './auth/login.tsx' },
  },
})
export default class Server {}
```

Absolute paths pass through unchanged. If the declaring file's directory can't be captured (exotic loader), the framework falls back to `process.cwd()` with a warning — use an absolute path if that's wrong.

### Slots

| Slot          | Replaces the built-in…                      | Key fields the component receives         |
| ------------- | ------------------------------------------- | ----------------------------------------- |
| `login`       | Local sign-in page                          | `clientName`, `scopes`, `redirectUri`     |
| `consent`     | Tool-consent screen                         | `tools[]` (selectable tool cards)         |
| `incremental` | Single-app incremental authorization screen | `extras.appId` / `extras.appName`         |
| `federated`   | Multi-provider selection                    | `providers[]` (selectable provider cards) |
| `error`       | OAuth error page                            | `error` text                              |

Map only the slots you want to customize — the rest keep their built-in pages.

### Per-app scoping (`splitByApp`)

`auth.ui` / `auth.extras` are **scoped to the auth config they live on** (like `consent`). Under `splitByApp`, each `@App({ auth: { mode, ui, extras } })` gets its OWN custom auth UI (paths anchored to that `@App` file); the parent multi-app scope uses the top-level `@FrontMcp({ auth })` (paths anchored to the server file).

## Server: `auth.extras` — validated extra fields

An `auth.extras[name]` entry is a **server handler function** that adds a server-validated side endpoint your page can POST to **mid-flow**, without finishing the authorization. Each accepted submission is appended to a per-`(pending-auth, extra)` accumulator the framework keeps; the response carries the full accumulator map back so the page refreshes without a reload.

```ts
import { type AuthExtraContext } from '@frontmcp/sdk';

export async function addEnv(input: Record<string, unknown>, ctx: AuthExtraContext) {
  const key = typeof input['key'] === 'string' ? input['key'].trim() : '';
  if (!key) return { ok: false as const, error: 'key is required' };
  if (ctx.current.some((it) => (it as { key?: string }).key === key)) {
    return { ok: false as const, error: `"${key}" was already added` };
  }
  const value = typeof input['value'] === 'string' ? input['value'] : '';
  // `addedItems` here is the list of NEW items to APPEND on success.
  return { ok: true as const, addedItems: [{ key, value }] };
}
```

The handler returns `{ ok, error?, addedItems?, sideEffects? }` (sync or async). The `ctx` is minimal and PII-free: `{ name, pendingAuthId?, current }` (`current` is what's already accepted for this extra). Declare it under `auth`: `@FrontMcp({ auth: { mode: 'local', extras: { 'envs:add': addEnv } } })`.

## The `AuthFlowState` a component receives

| Field           | Type                      | Notes                                                                    |
| --------------- | ------------------------- | ------------------------------------------------------------------------ |
| `slot`          | `AuthSlot`                | Which page slot is rendering.                                            |
| `pendingAuthId` | `string?`                 | Correlation id; round-tripped on every submit. Absent only for `error`.  |
| `clientName`    | `string?`                 | OAuth client display name (**not** an end user).                         |
| `clientId`      | `string?`                 | OAuth `client_id`.                                                       |
| `scopes`        | `string[]`                | Requested OAuth scopes.                                                  |
| `redirectUri`   | `string?`                 | Validated `redirect_uri` the code is sent to.                            |
| `resource`      | `string?`                 | RFC 8707 resource indicator, when supplied.                              |
| `error`         | `string?`                 | Error text (error slot, or a re-rendered failed submit).                 |
| `csrfToken`     | `string?`                 | Server-minted anti-CSRF token. The hooks echo it for you.                |
| `providers`     | `AuthProvider[]`          | Selectable providers on the `federated` slot.                            |
| `tools`         | `AuthTool[]`              | Selectable tools on the `consent` slot.                                  |
| `extras`        | `Record<string, unknown>` | Free-form, slot-specific extras (e.g. logo URI, incremental target app). |

**No PII is in the contract.** Anything the user types (email, name, …) travels in your own form fields, never in `AuthFlowState`.

## Client: `@frontmcp/ui/auth`

```bash
npm install @frontmcp/ui react react-dom
```

`react` / `react-dom` are peer dependencies of `@frontmcp/ui`.

| Import                      | Use                                                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@frontmcp/ui/auth`         | The framework-free contract types + wire constants (no React) **and** React hooks (`useAuthFlow`, …) + `<AuthPageWrapper>` + `mountAuthPage`. Single source of truth for the client API; imports only `react`/`react-dom` — no MUI. |
| `@frontmcp/ui/auth/vanilla` | Framework-free (browser) helpers: `getAuthFlow`, `submitFinish`, `submitExtra`, `getAddedItems` (plus the contract types).                                                                                                          |

### React hooks + wrapper + client mount

- **`useAuthFlow()`** — the flow-state fields above plus a `submitFinish` handler. `<form onSubmit={submitFinish}>` `preventDefault`s, serializes the form, attaches `pending_auth_id` + `csrf` + the slot marker, posts to the callback, and follows the OAuth redirect.
- **`useExtraField(name)`** — `{ onSubmit, result, pending }` for an `auth.extras` form. On success it merges the returned `addedItems` back into context.
- **`useAddedItems(name)`** — the server-side accumulator for a named extra, reactively.
- **`<AuthPageWrapper>`** — outer chrome that reads the injected state once, provides it via context, and (by default) renders the enclosing `<form>` with the `pending_auth_id` + `csrf` hidden fields so a no-JS submit still works. Pass `renderForm={false}` to supply your own forms.
- **`mountAuthPage(Component, options?)`** — the client entrypoint; wraps `Component` in `<AuthPageWrapper>` and renders it (`createRoot(...).render(...)`) into the empty `#frontmcp-auth-root` node in the browser. Pure client render — no server markup to hydrate. **The SDK appends `mountAuthPage(<your default export>)` to the inlined module for you**, so a `file`-based component just needs a default export (loaded in the browser from esm.sh via the import-map).

### Vanilla (no framework)

`@frontmcp/ui/auth/vanilla` exposes the same flow without React: `getAuthFlow()` (read `window.__FRONTMCP_AUTH__`; `tryGetAuthFlow()` is tolerant), `getAddedItems(name)`, `submitFinish(formOrData?)`, and `submitExtra(name, formOrData?)`.

## Routes the server adds

When at least one `auth.extras` handler is configured (otherwise it 404s / falls through, so defaults are untouched):

| Route             | Method | Purpose                                                                                                                                                                             |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/oauth/ui/extra` | `POST` | Routes an `auth.extras[name]` submission (the `action` field names the extra) to its handler; returns `{ ok, error?, addedItems?, sideEffects? }`. CSRF-verified (400 on mismatch). |

There is **no `/oauth/ui/:slot.js` route** — the component is transpiled server-side and **inlined** into the authorize/callback page as a `<script type="module">` (deps from esm.sh via the import-map), so there is no separately-served bundle. The pages themselves are served by the existing `/oauth/authorize` + `/oauth/callback` flows; an `auth.ui` slot swaps the served page body (import-map + injected state + the inline transpiled module + empty mount) — the component renders client-side. The finish submit still posts to `/oauth/callback`.

## Security — the framework owns it

- **CSRF**: the server mints a per-pending-authorization token, stores it (echoed into `csrfToken`), and verifies it on the finish submit and every `auth.extras` POST with a constant-time compare. Your component never generates or checks it.
- **CSP + anti-clickjacking**: the auth-UI HTML ships with a strict CSP — `default-src 'self'; script-src 'self' 'unsafe-inline' https://esm.sh; connect-src 'self' https://esm.sh; style-src 'self' 'unsafe-inline' https://esm.sh; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` — plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. It allows `https://esm.sh` (deps) + `'unsafe-inline'` (the JSON-escaped state script) but **NOT `'unsafe-eval'`** — the transform is server-side, never in the browser.
- **No PII**: the injected state carries OAuth client identifiers + control fields only.
- **Fail-safe**: a component that can't be transpiled (missing / invalid `.tsx`) is logged (error cached so a broken file isn't retried each request) and **falls back to the built-in page** — a broken custom page can't take the server down.

## Local dev / offline (esm.sh caveat)

The browser loads `react`, `react-dom`, and `@frontmcp/ui/auth` from **esm.sh**. `react`/`react-dom` are always there, but `@frontmcp/ui/auth` resolves only once **published to npm**. In an unpublished monorepo, an in-browser render can't fetch it — though the SERVER still emits the full page (import-map + injected state + inline transpiled module), so HTTP-level checks pass; only the browser DOM render is affected. To render before publishing, map the specifier to a locally-served ESM URL via `@FrontMcp({ ui: { cdnOverrides } })`:

```ts
@FrontMcp({
  ui: { cdnOverrides: { '@frontmcp/ui/auth': 'http://localhost:5173/ui-auth.mjs' } },
  auth: { mode: 'local', ui: { login: './auth/login.tsx' } },
})
```

A non-esm.sh override URL is left as-is (no `?external=react`). Once published, no overrides are needed.

## Examples

| Example                                                                        | Level        | Description                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`login-slot`](../examples/custom-auth-ui/login-slot.md)                       | Intermediate | Replace the built-in login page with a custom React component via auth.ui: { login: './login.tsx' } and useAuthFlow, while the framework keeps owning CSRF and CSP.                                             |
| [`multi-step-auth-extra`](../examples/custom-auth-ui/multi-step-auth-extra.md) | Advanced     | Add a server-validated multi-step field to a custom login page with auth.extras: { 'envs:add': fn }, useExtraField, and useAddedItems — accepted rows accumulate server-side and reflect back without a reload. |

## See also

- Docs: [Custom Authorization UI (`auth.ui`)](https://docs.agentfront.dev/frontmcp/authentication/custom-ui)
- `frontmcp-config` → `configure-auth` — the declarative `login` / `authenticate` config (tweak the built-in page's fields without React)
- `create-tool` → `ui-widgets` — the `@Tool({ ui: { file } })` widget pipeline this mirrors
