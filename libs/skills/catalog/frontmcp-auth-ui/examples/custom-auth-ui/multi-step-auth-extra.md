---
name: multi-step-auth-extra
reference: custom-auth-ui
level: advanced
description: "Add a server-validated multi-step field to a custom login page with auth.extras: { 'envs:add': fn }, useExtraField, and useAddedItems — accepted rows accumulate server-side and reflect back without a reload."
tags: [auth, auth-ui, auth-extras, useExtraField, useAddedItems, multi-step, react]
features:
  - "Declaring a server-validated field as an `auth.extras['envs:add']` handler fn returning `{ ok, error?, addedItems? }`"
  - 'Rejecting bad input and duplicates using `ctx.current` (the items already accepted for this extra in this flow)'
  - "Binding the add-row form to `useExtraField('envs:add').onSubmit` (POSTs to `/oauth/ui/extra` with `pending_auth_id` + `csrf` attached)"
  - "Reflecting the server-side accumulator reactively with `useAddedItems('envs:add')` after each successful add"
  - 'Declaring both the `auth.ui` slot and the `auth.extras` handler under `auth`: `@FrontMcp({ auth: { mode, ui, extras } })`'
---

# Multi-Step Field with `auth.extras`

Add a server-validated multi-step field to a custom login page with auth.extras: { 'envs:add': fn }, useExtraField, and useAddedItems — accepted rows accumulate server-side and reflect back without a reload.

An `auth.extras[name]` handler adds a side endpoint the page POSTs to mid-flow (without finishing
the authorization). Each accepted submission is appended to a per-`(pending-auth, extra)`
accumulator the framework keeps; the response carries the full accumulator back so the page
refreshes via `useAddedItems` without a reload. CSRF is verified server-side on every POST.

## Code

```ts
// src/auth/extras.ts — the extra handler (a plain function, no class)
import { type AuthExtraContext } from '@frontmcp/sdk';

// Validates an "add environment variable" submission and accumulates accepted rows.
export async function addEnv(input: Record<string, unknown>, ctx: AuthExtraContext) {
  const key = typeof input['key'] === 'string' ? input['key'].trim() : '';
  if (!key) return { ok: false as const, error: 'key is required' };
  // ctx.current = rows already accepted for this extra in this pending auth.
  if (ctx.current.some((it) => (it as { key?: string }).key === key)) {
    return { ok: false as const, error: `"${key}" was already added` };
  }
  const value = typeof input['value'] === 'string' ? input['value'] : '';
  // `addedItems` is the list of NEW rows to APPEND on success; the framework
  // returns the FULL accumulator map back to the client.
  return { ok: true as const, addedItems: [{ key, value }] };
}
```

```tsx
// src/auth/login.tsx — the custom component (default export)
import React from 'react';

import { AuthPageWrapper, useAddedItems, useAuthFlow, useExtraField } from '@frontmcp/ui/auth';

export default function LoginPage(): React.ReactElement {
  const { clientName, error, submitFinish } = useAuthFlow();
  // Reactive view of the server-side accumulator for the 'envs:add' extra.
  const envs = useAddedItems<{ key: string; value: string }>('envs:add');
  // onSubmit POSTs to /oauth/ui/extra with pending_auth_id + csrf attached.
  const addEnv = useExtraField('envs:add');

  return (
    <AuthPageWrapper>
      <h1>Connect {clientName ?? 'the application'}</h1>
      {error && <p className="error">{error}</p>}

      <ul data-testid="env-list">
        {envs.map((e) => (
          <li key={e.key}>
            {e.key}={e.value}
          </li>
        ))}
      </ul>

      {/* validated extra field — routes to auth.extras['envs:add'] */}
      <form onSubmit={addEnv.onSubmit}>
        <input name="key" placeholder="KEY" />
        <input name="value" placeholder="value" />
        <button disabled={addEnv.pending}>Add</button>
        {addEnv.result && !addEnv.result.ok && <span className="error">{addEnv.result.error}</span>}
      </form>

      {/* finish — posts pending_auth_id + csrf and follows the OAuth redirect */}
      <form onSubmit={submitFinish}>
        <input name="email" type="email" />
        <button type="submit">Authorize</button>
      </form>
    </AuthPageWrapper>
  );
}

// The SDK appends `mountAuthPage(LoginPage)` to the inlined module automatically — a
// `file`-based component only needs a default export.
```

```ts
// src/server.ts — declare BOTH the slot and the extra UNDER `auth`
import { FrontMcp } from '@frontmcp/sdk';

import { addEnv } from './auth/extras';

@FrontMcp({
  info: { name: 'MyServer', version: '1.0.0' },
  // `ui` / `extras` are scoped to this auth config (per-app under splitByApp).
  // The login path is relative + auto-anchored to THIS file — no fileURLToPath.
  auth: {
    mode: 'local',
    requireEmail: false,
    ui: { login: './auth/login.tsx' },
    extras: { 'envs:add': addEnv },
  },
})
export default class Server {}
```

## What This Demonstrates

- Declaring a server-validated field as an `auth.extras['envs:add']` handler fn returning `{ ok, error?, addedItems? }`
- Rejecting bad input and duplicates using `ctx.current` (the items already accepted for this extra in this flow)
- Binding the add-row form to `useExtraField('envs:add').onSubmit` (POSTs to `/oauth/ui/extra` with `pending_auth_id` + `csrf` attached)
- Reflecting the server-side accumulator reactively with `useAddedItems('envs:add')` after each successful add
- Declaring both the `auth.ui` slot and the `auth.extras` handler under `auth`: `@FrontMcp({ auth: { mode, ui, extras } })`

## Notes

- **Wire shape**: a successful `POST /oauth/ui/extra` returns `{ ok: true, addedItems: { 'envs:add': [...] } }`
  (the FULL accumulator map keyed by extra name). `useExtraField` merges it into context so
  `useAddedItems` re-renders.
- **Validation errors**: a rejected submit returns HTTP 400 with `{ ok: false, error }`; surface
  `addEnv.result.error` in the form.
- **CSRF**: the framework verifies the `csrf` token (minted at SSR time) on every extra POST and
  on the finish submit — a mismatch is rejected 400. The hooks attach it for you; never generate
  or check it in your component.
- **PII-free `ctx`**: the handler's `ctx` is `{ name, pendingAuthId?, current }` only — no user
  identity is passed to it.
- **Persistence**: the accumulator is in-memory and keyed by the opaque pending-auth id (10-minute
  TTL), so it survives across re-renders within one authorization but not across server restarts.
