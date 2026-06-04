/**
 * A `splitByApp` app that declares its OWN local auth + custom auth UI under
 * `@App({ auth: { mode: 'local', ui: { login: './login.tsx' } } })` — proving
 * the per-app scoping of `auth.ui` (#469 follow-up). Each split app builds its
 * own `AuthUiRegistry` from its own `auth.ui`, so this app's `/oauth/authorize`
 * renders ITS custom login component.
 *
 * The `auth.ui` path is RELATIVE and auto-anchored to THIS `@App` file's
 * directory (the login.tsx is colocated here) — no manual path anchoring, no class.
 */
import { App } from '@frontmcp/sdk';

import PingTool from '../consent/tools/ping.tool';
import { addEnvExtra } from './auth-ui.entries';

@App({
  name: 'SplitAuthUi',
  description: 'Split-by-app variant whose own auth config carries a custom auth.ui login',
  tools: [PingTool],
  auth: {
    mode: 'local',
    tokenStorage: 'memory',
    requireEmail: false,
    anonymousSubject: 'local-operator',
    // Per-app custom auth UI — scoped to THIS app's auth config, anchored to
    // this @App source file (login.tsx is colocated).
    ui: { login: './login.tsx' },
    extras: { 'envs:add': addEnvExtra },
  },
})
export class SplitAuthUiApp {}
