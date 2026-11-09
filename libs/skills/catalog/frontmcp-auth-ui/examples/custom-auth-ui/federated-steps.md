---
name: federated-steps
reference: custom-auth-ui
level: advanced
description: 'Walk the provider picker one provider per page with incrementalAuth.showAllAppsAtOnce: false and a custom federated slot that reads extras.step and answers continue, skip or back.'
tags: [auth, auth-ui, federated, incremental-auth, multi-step, react]
features:
  - 'Turning on the step-by-step provider picker with `incrementalAuth: { showAllAppsAtOnce: false }`'
  - 'Reading the step a page answers from `extras.step` (`index`, `count`, `providerId`, `last`, `canGoBack`, `canSkip`)'
  - 'Answering it with `submitFinish({ federated, federated_step, action })`, where `action` is `continue`, `skip` or `back`'
  - 'Sending the sign-in fields (`email`) with the answer to the last step, which finishes the sign-in'
  - 'Hiding Skip for a provider the sign-in must link, which the server refuses to skip anyway'
---

# Step-by-Step Provider Picker with a Custom `federated` Slot

Walk the provider picker one provider per page with incrementalAuth.showAllAppsAtOnce: false and a custom federated slot that reads extras.step and answers continue, skip or back.

With `incrementalAuth.showAllAppsAtOnce: false`, the sign-in asks about one provider per page
instead of showing every provider on one picker page. The server keeps each answer on the
pending authorization and serves the next step's page; the page only renders the step it is
given in `extras.step` and posts the answer back.

## Code

```ts
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';

import { CrmApp } from './apps/crm';
import { TasksApp } from './apps/tasks';

@FrontMcp({
  info: { name: 'desk', version: '1.0.0' },
  apps: [TasksApp, CrmApp], // each with its own `auth`, so the sign-in offers its provider
  auth: {
    mode: 'local',
    incrementalAuth: { enabled: true, showAllAppsAtOnce: false },
    ui: { federated: './auth/federated.tsx' },
  },
})
export default class Server {}
```

```tsx
// src/auth/federated.tsx
import React from 'react';

import { useAuthFlow } from '@frontmcp/ui/auth';

interface FederatedStep {
  index: number;
  count: number;
  providerId: string;
  last: boolean;
  canGoBack: boolean;
  canSkip: boolean;
  decision?: 'continue' | 'skip';
}

export default function ProviderStep(): React.ReactElement {
  const { clientName, providers, extras, error, submitFinish } = useAuthFlow();
  const step = extras['step'] as FederatedStep;
  const provider = providers.find((p) => p.id === step.providerId);
  const [email, setEmail] = React.useState('');

  const answer = (action: 'continue' | 'skip' | 'back') =>
    submitFinish({
      federated: 'true',
      federated_step: String(step.index),
      action,
      // The answer to the last step finishes the sign-in, so it carries the sign-in fields.
      ...(step.last && action !== 'back' ? { email } : {}),
    });

  return (
    <main>
      <p>
        Step {step.index + 1} of {step.count}
      </p>
      <h1>Authorize {provider?.name ?? step.providerId}</h1>
      <p>{clientName} uses several providers. Authorize them one at a time.</p>
      {error && <p className="error">{error}</p>}
      {step.last && (
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      )}
      <button onClick={() => answer('continue')}>{step.last ? 'Finish' : 'Continue'}</button>
      {step.canSkip && <button onClick={() => answer('skip')}>Skip</button>}
      {step.canGoBack && <button onClick={() => answer('back')}>Back</button>}
    </main>
  );
}
```

## What This Demonstrates

- Turning on the step-by-step provider picker with `incrementalAuth: { showAllAppsAtOnce: false }`
- Reading the step a page answers from `extras.step` (`index`, `count`, `providerId`, `last`, `canGoBack`, `canSkip`)
- Answering it with `submitFinish({ federated, federated_step, action })`, where `action` is `continue`, `skip` or `back`
- Sending the sign-in fields (`email`) with the answer to the last step, which finishes the sign-in
- Hiding Skip for a provider the sign-in must link, which the server refuses to skip anyway

## Notes

- **Order**: the steps follow the picker's order: the top-level `auth.providers` (or the server's own
  sign-in, `__parent__`, when there are none), then the provider of every app with its own `auth`.
- **Server-side checks at every step**: `submitFinish` attaches `pending_auth_id` and `csrf`; a step
  without the CSRF token, or posted from another origin, is refused (400). Skipping a provider in
  `federatedAuth.requiredProviders`, or any app's provider under `incrementalAuth.allowSkip: false`, is
  refused (400 `Required provider(s) not linked: <id>`), and so is a skip that leaves fewer providers
  than `federatedAuth.minProviders` to link.
- **Stale pages**: an answer for another step than the one the server is on (an old tab, the browser's
  back button) changes nothing and gets the current step's page again.
- **The last step**: its answer goes on exactly like the one-page picker's submission: the sign-in
  fields are checked (or `authenticate()` runs; a refusal shows the last step again with its message),
  then the sign-in goes to the first linked provider, or the code is issued.
- **Built-in page**: without `ui.federated`, the built-in step page does the same, with Continue, Skip
  and Back buttons.
