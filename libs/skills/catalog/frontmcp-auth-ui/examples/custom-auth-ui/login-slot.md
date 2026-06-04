---
name: login-slot
reference: custom-auth-ui
level: intermediate
description: "Replace the built-in login page with a custom React component via auth.ui: { login: './login.tsx' } and useAuthFlow, while the framework keeps owning CSRF and CSP."
tags: [auth, auth-ui, login, custom-ui, react, client-rendered]
features:
  - "Mapping a slot to a `.tsx` file with `auth.ui: { login: './login.tsx' }` (the supported render path)"
  - 'Using a RELATIVE path auto-anchored to the config file — no `fileURLToPath`, no decorator, no class'
  - 'Reading the injected `AuthFlowState` via `useAuthFlow()` and submitting with `<form onSubmit={submitFinish}>`'
  - 'Letting `<AuthPageWrapper>` render the enclosing finish `<form>` with the `pending_auth_id` + `csrf` hidden fields'
  - 'The SDK transpiling the `.tsx` server-side and inlining it as an ES module (deps from esm.sh via an import-map) + appending the `mountAuthPage` call automatically'
---

# Custom Login Slot with `auth.ui`

Replace the built-in login page with a custom React component via auth.ui: { login: './login.tsx' } and useAuthFlow, while the framework keeps owning CSRF and CSP.

The component reads the server-injected flow state through `useAuthFlow()` and renders
its own sign-in form. The framework injects `window.__FRONTMCP_AUTH__`, mints the CSRF
token, sets the CSP, transpiles the `.tsx` server-side, and inlines it into the authorize
page as a `<script type="module">` with an esm.sh import-map (no bundling, no SSR) — the
developer writes only the UI.

## Code

```tsx
// src/auth/login.tsx — the custom component (default export)
import React from 'react';

import { AuthPageWrapper, useAuthFlow } from '@frontmcp/ui/auth';

export default function LoginPage(): React.ReactElement {
  // useAuthFlow() returns the injected state + a submitFinish handler. Everything
  // OAuth (pending id, csrf, submit target, slot markers) is already wired.
  const { clientName, scopes, error, submitFinish } = useAuthFlow();

  return (
    // AuthPageWrapper renders the enclosing <form> (with pending_auth_id + csrf
    // hidden fields) so a no-JS submit works; submitFinish drives the JS path.
    <AuthPageWrapper>
      <h1>Sign in to {clientName ?? 'the application'}</h1>
      {scopes.length > 0 && <p>Requested access: {scopes.join(', ')}</p>}
      {error && <p className="error">{error}</p>}

      <form onSubmit={submitFinish}>
        <label>
          Email
          <input type="email" name="email" placeholder="you@example.com" required />
        </label>
        <button type="submit">Continue</button>
      </form>
    </AuthPageWrapper>
  );
}

// No need to call mountAuthPage here: the SDK appends `mountAuthPage(LoginPage)` to the
// inlined module automatically, so a `file`-based component only needs a default export.
```

```ts
// src/server.ts — map the slot UNDER `auth` (per-app under splitByApp)
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'MyServer', version: '1.0.0' },
  auth: {
    mode: 'local',
    // Custom auth UI is a slot→file map, scoped to this auth config. The relative
    // path is auto-anchored to THIS server file's directory — no fileURLToPath.
    ui: { login: './auth/login.tsx' },
    // Single-operator dev convenience: email optional so a no-JS submit can mint a code.
    requireEmail: false,
  },
})
export default class Server {}
```

## What This Demonstrates

- Mapping a slot to a `.tsx` file with `auth.ui: { login: './login.tsx' }` (the supported render path)
- Using a RELATIVE path auto-anchored to the config file — no `fileURLToPath`, no decorator, no class
- Reading the injected `AuthFlowState` via `useAuthFlow()` and submitting with `<form onSubmit={submitFinish}>`
- Letting `<AuthPageWrapper>` render the enclosing finish `<form>` with the `pending_auth_id` + `csrf` hidden fields
- The SDK transpiling the `.tsx` server-side and inlining it as an ES module (deps from esm.sh via an import-map) + appending the `mountAuthPage` call automatically

## Notes

- **File path**: the path is relative to the file that declares the `@FrontMcp`/`@App` config and
  is auto-anchored at decoration time — no manual `fileURLToPath`. Absolute paths also work.
- **Build exclusion**: keep the `.tsx` out of the server's own typecheck (the SDK transpiles it
  separately) — e.g. place it where the scaffolded `tsconfig.json`'s `exclude` keeps it out.
- **Fallback**: if the component can't be transpiled (missing / invalid `.tsx`), the framework
  logs it and serves the built-in login page instead — a broken custom page can't take the server down.
- **esm.sh deps**: the browser loads `@frontmcp/ui/auth` from esm.sh via the import-map; in an
  unpublished monorepo, map it to a local URL via `@FrontMcp({ ui: { cdnOverrides } })` (see the reference).
- **No PII**: the user's email lives in your `<form>`'s `email` input, never in `AuthFlowState`.
