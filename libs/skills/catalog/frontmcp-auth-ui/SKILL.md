---
name: frontmcp-auth-ui
description: 'Use when you want to customize, brand, or replace the built-in FrontMCP login / consent / federated / incremental / error pages with your own React component. Covers the `auth.ui` slot→file map + `auth.extras` name→handler map on the auth config (no decorator, no class), the `@frontmcp/ui/auth` React hooks + `<AuthPageWrapper>` + `mountAuthPage` (client-rendered via an esm.sh import-map + a server-side per-file transform — no bundling, no SSR), and the framework-owned CSRF + CSP. The skill for CUSTOM AUTHORIZATION UI.'
tags: [auth, auth-ui, login, consent, custom-ui, react, oauth, guide]
category: config
targets: [all]
bundle: [full]
priority: 5
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/authentication/custom-ui
---

# FrontMCP Custom Authorization UI (`auth.ui`)

Entry point for replacing FrontMCP's built-in OAuth pages (login, consent, federated, incremental, error) with your own React components. Custom UI is a simple **slot→file map** (`auth.ui`) plus an extras **name→handler map** (`auth.extras`) on the auth config — there is no decorator and no class. The `references/custom-auth-ui.md` reference has the full API; the `examples/` show a single login slot and a multi-step extras form.

## When to Use This Skill

### Must Use

- Branding or fully replacing the `local`/`remote` mode **login** page with a custom React component
- Building a custom **consent** screen, **federated** provider picker, **incremental** authorization, or **error** page
- Adding a server-validated multi-step field to an authorization page (e.g. "add another item") via `auth.extras`

### Recommended

- Understanding which half is the server (`auth.ui` / `auth.extras` in `@frontmcp/sdk`) and which is the client (`@frontmcp/ui/auth`)
- Looking up the `AuthFlowState` fields a slot component receives, or the `/oauth/ui/extra` route
- Confirming that the framework (not your component) owns CSRF + CSP

### Skip When

- You only need to add/rename **fields** on the built-in login page or run a custom verifier — use the declarative `login` / `authenticate` config in `frontmcp-config` → `configure-auth` instead (no React, no build step)
- You are customizing a **tool widget** (not an auth page) — use `create-tool` → `ui-widgets`
- You don't need a custom page at all — configuring no `auth.ui` keeps the built-in pages

> **Decision:** Use this skill when you want to render your OWN component for an auth slot. Use `configure-auth`'s declarative `login` config when tweaking the built-in page's fields is enough.

## Prerequisites

- A FrontMCP server in `local` or `remote` auth mode (see `frontmcp-config` → `configure-auth`)
- `@frontmcp/ui`, `react`, and `react-dom` installed (`react`/`react-dom` are peer deps of `@frontmcp/ui`)

## Steps

1. Write a React component (default export) for the slot, reading the injected state via `@frontmcp/ui/auth` hooks (see `references/custom-auth-ui.md`)
2. Map the slot to its `.tsx` path under `auth.ui` — a RELATIVE path auto-anchored to the config file's directory (no `fileURLToPath`)
3. (Optional) Add an `auth.extras[name]` handler function for any mid-flow validated field
4. Declare both **under `auth`**: `@FrontMcp({ auth: { mode: 'local', ui: { login: './…' }, extras: { … } } })` (per-app under `splitByApp` — put them on the `@App({ auth })` that owns the pages)
5. Verify using the Verification Checklist below

## Scenario Routing Table

| Scenario                                                       | Reference        | Description                                                                          |
| -------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| Replace any built-in auth page with a React component          | `custom-auth-ui` | `auth.ui: { slot: './file.tsx' }`, the hooks, `<AuthPageWrapper>`, `mountAuthPage`   |
| Add a server-validated mid-flow field (multi-step form)        | `custom-auth-ui` | `auth.extras: { name: handler }`, the accumulator, `useExtraField` / `useAddedItems` |
| Look up the flow-state fields a component receives             | `custom-auth-ui` | `AuthFlowState` field table (no PII)                                                 |
| Understand the served route and the framework-owned CSRF + CSP | `custom-auth-ui` | `/oauth/ui/extra`, the esm.sh import-map + inline module, security ownership         |

## The map form

Custom UI is a **slot→file map** on the auth config. Point each slot at a sibling `.tsx`/`.jsx` source (default export); the SDK transpiles it once server-side and inlines it as an ES module, with deps loaded from esm.sh via an import-map and `mountAuthPage` appended for you — exactly as `@Tool({ ui })` leads with the `FileSource` `{ file }` form:

```ts
// src/server.ts
import { App } from '@frontmcp/sdk'; // or @FrontMcp

@App({
  auth: {
    mode: 'local',
    // slot → RELATIVE .tsx, auto-anchored to THIS config file's directory.
    ui: { login: './auth/login.tsx' },
    // extra name → handler fn (no class).
    extras: { 'envs:add': async (input, ctx) => ({ ok: true, addedItems: [{ key: String(input.key) }] }) },
  },
})
export default class Server {}
```

A relative `auth.ui` path resolves against the directory of the file that declares the `@App`/`@FrontMcp` config — captured automatically at decoration time. **No `fileURLToPath` needed.** Absolute paths pass through; on capture failure the framework falls back to `process.cwd()` with a warning.

## Common Patterns

| Pattern            | Correct                                                                      | Incorrect                                                | Why                                                                                         |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Slot registration  | `auth: { ui: { login: './login.tsx' } }`                                     | `auth: { ui: [LoginAuthUi] }` (array of classes)         | Custom UI is a slot→file MAP now — no decorator, no class                                   |
| Path anchoring     | Relative `'./login.tsx'` (auto-anchored to the config file)                  | `fileURLToPath(new URL('./login.tsx', import.meta.url))` | The framework captures the config file's dir for you — manual anchoring is no longer needed |
| Extra registration | `auth: { extras: { 'envs:add': handlerFn } }`                                | `auth: { extras: [AddEnvExtra] }` (annotated class)      | Extras are an extra-name → handler-function MAP now                                         |
| CSRF               | Let the hooks round-trip `csrfToken`                                         | Generating / checking a token in your component          | The server mints + verifies CSRF; your component must not                                   |
| User identity      | User-typed fields live in your own `<form>` inputs                           | Putting email/name into `AuthFlowState`                  | `AuthFlowState` is PII-free by contract — it carries OAuth client ids + control fields only |
| Wrapper form       | Wrap UI in `<AuthPageWrapper>` (renders the finish `<form>` + hidden fields) | Hand-rolling `pending_auth_id` / `csrf` hidden inputs    | The wrapper injects the control fields so a no-JS submit still works                        |

## Verification Checklist

- [ ] `GET /oauth/authorize` returns a page with an EMPTY `#frontmcp-auth-root` (not the built-in page) — the component's rendered markup is NOT in the HTTP response
- [ ] The page has a `<script type="module">` with the TRANSPILED component (`React.createElement`, NOT a bundle/IIFE/`react-dom/server`) + an `import { mountAuthPage } from '@frontmcp/ui/auth'` tail
- [ ] The page has a `<script type="importmap">` mapping `react` + `@frontmcp/ui/auth` → `https://esm.sh/...`, with `?external=react,react-dom` on the `@frontmcp/*` URLs (single React)
- [ ] The HTML injects `window.__FRONTMCP_AUTH__` with the flow state (and no PII — no `email`/`name` field)
- [ ] Response carries the auth CSP headers (`frame-ancestors 'none'`, `https://esm.sh` allowed, NO `'unsafe-eval'`) and `X-Frame-Options: DENY`
- [ ] There is **no** `/oauth/ui/<slot>.js` route (it 404s — the module is inlined, not served separately)
- [ ] (If using `auth.extras`) a valid `POST /oauth/ui/extra` returns `{ ok: true, addedItems }`, an invalid one returns 400, and a bad `csrf` returns 400
- [ ] Removing the slot from `auth.ui` falls back to the built-in page unchanged

## Troubleshooting

| Problem                                              | Cause                                                      | Solution                                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Built-in page still shows                            | Slot not in `auth.ui`, or the `.tsx` failed to transpile   | Confirm the slot is in `auth: { ui: { … } }` on the scope that owns the pages; check logs — a transpile error falls back to the built-in page                      |
| Blank page / `@frontmcp/ui/auth` 404s in the browser | `@frontmcp/ui/auth` isn't on esm.sh (unpublished monorepo) | Publish `@frontmcp/ui`, OR map it to a locally-served ESM URL via `@FrontMcp({ ui: { cdnOverrides } })` (see `references/custom-auth-ui.md` → Local dev / offline) |
| `ENOENT` / component not found at runtime            | Path doesn't resolve from the config file's dir            | Use a path relative to the config file (auto-anchored), or an absolute path                                                                                        |
| Hooks throw "must be used inside …"                  | Component rendered without `<AuthPageWrapper>`             | Mount via `mountAuthPage(Component)` (it wraps for you) or wrap manually in `<AuthPageWrapper>`                                                                    |
| extras POST returns 400 (csrf)                       | The submitted `csrf` ≠ the server-minted token             | Let the hooks send it — `useExtraField` / `submitExtra` attach `pending_auth_id` + `csrf` automatically                                                            |
| Custom page can't import `@frontmcp/ui/auth`         | Package (or `react`/`react-dom`) not installed             | `npm install @frontmcp/ui react react-dom`                                                                                                                         |

## Examples

Each reference has matching examples under [`examples/<reference>/`](./examples/):

### `custom-auth-ui`

| Example                                                                       | Level        | Description                                                                                                              |
| ----------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [`login-slot`](./examples/custom-auth-ui/login-slot.md)                       | Intermediate | Replace the built-in login page with a custom React component via `auth.ui: { login: './login.tsx' }` and `useAuthFlow`. |
| [`multi-step-auth-extra`](./examples/custom-auth-ui/multi-step-auth-extra.md) | Advanced     | Add a server-validated multi-step field with `auth.extras: { 'envs:add': fn }`, `useExtraField`, and `useAddedItems`.    |

## Accessing This Skill

Skills are distributed as plain SKILL.md files plus a sibling `references/`
and `examples/` tree, so consumers can pick whichever access mode fits:

| Mode               | How it works                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**     | Read `libs/skills/catalog/frontmcp-auth-ui/` directly from a clone of the catalog repo, or from a published `@frontmcp/skills` install. SKILL.md is the entry point.                                                                                                                                                                              |
| **`frontmcp` CLI** | `frontmcp skills list`, `frontmcp skills read frontmcp-auth-ui`, `frontmcp skills read frontmcp-auth-ui:references/<file>.md`, `frontmcp skills install frontmcp-auth-ui` — no server required.                                                                                                                                                   |
| **MCP `skill://`** | When a developer mounts this skill into their own FrontMCP server (`@FrontMcp({ skills: [...] })`), the SDK exposes it via SEP-2640 resources: `skill://frontmcp-auth-ui/SKILL.md`, `skill://frontmcp-auth-ui/references/{file}.md`, etc. The server's `skill://index.json` returns the SEP-2640 discovery document for everything mounted on it. |

The catalog itself is **not** an MCP server. The `skill://` URIs only resolve
when a server has been configured to host this skill.

## Reference

- [Custom Authorization UI (`auth.ui`)](https://docs.agentfront.dev/frontmcp/authentication/custom-ui)
- Related skills: `frontmcp-config` (→ `configure-auth` for the declarative `login` config), `create-tool` (→ `ui-widgets` for tool widgets)
