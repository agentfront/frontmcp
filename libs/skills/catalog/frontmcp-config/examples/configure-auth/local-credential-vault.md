---
name: local-credential-vault
reference: configure-auth
level: intermediate
description: 'Persist a per-session credential from a local authenticate() verifier into the built-in encrypted vault and read it from a tool via this.credentials.'
tags: [config, auth, local, vault, credentials, this-credentials]
features:
  - 'Returning `credentials: [{ key, secret, metadata? }]` from `authenticate()` so FrontMCP persists them encrypted, keyed by the minted `sub`'
  - 'Reading a per-session credential from a tool via `this.credentials.get(key)` (no `this.authProviders` wiring needed)'
  - 'Prompting the agent to connect a missing credential mid-session with `this.credentials.requireConnect({ key })` (framework-signed `/oauth/connect` URL)'
  - 'Understanding per-session rotation: a reconnect yields an empty vault and old ciphertext is undecryptable'
---

# Local Mode with the Per-Session Credential Vault (`this.credentials`)

Persist a per-session credential from a local authenticate() verifier into the built-in encrypted vault and read it from a tool via this.credentials.

The vault is AES-256-GCM-encrypted, keyed by the authenticated `sub`, and enabled
automatically in `local` (and `remote`) modes — there is nothing to register.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'call_acme',
  description: 'Call the Acme API using the session credential',
  inputSchema: {},
  outputSchema: { connected: z.boolean(), connectUrl: z.string().optional() },
})
class CallAcmeTool extends ToolContext {
  async execute() {
    // Read the credential the verifier persisted at login.
    const cred = await this.credentials.get('acme'); // { secret, metadata } | undefined
    if (!cred) {
      // Not connected — hand the agent a framework-signed resume URL so the
      // user can connect it mid-session (verified server-side, short-lived).
      const res = await this.credentials.requireConnect({ key: 'acme' });
      if (!res.connected) return { connected: false, connectUrl: res.resumeUrl };
    }
    // const headers = { Authorization: `Bearer ${cred!.secret}` };
    // … call Acme with cred.secret / cred.metadata …
    return { connected: true };
  }
}

@App({ name: 'acme-tools', tools: [CallAcmeTool] })
class AcmeApp {}

@FrontMcp({
  info: { name: 'acme-server', version: '1.0.0' },
  apps: [AcmeApp],
  auth: {
    mode: 'local',
    login: {
      title: 'Connect Acme',
      fields: { apiKey: { type: 'password', label: 'Acme API Key', required: true } },
      subject: { fromField: 'apiKey', strategy: 'per-account' },
    },
    authenticate: async (input) => {
      // Mid-session connect re-invokes authenticate() with a `resume` context.
      if (input.resume) {
        const value = input.fields['apiKey'];
        if (!value) return { ok: false, message: 'A value is required', retryField: 'apiKey' };
        return { ok: true, credentials: [{ key: input.resume.key, secret: value }] };
      }
      // Initial login: validate and persist the credential into the vault.
      const apiKey = input.fields['apiKey'];
      if (!apiKey?.startsWith('sk-')) return { ok: false, message: 'Invalid API key', retryField: 'apiKey' };
      return {
        ok: true,
        credentials: [{ key: 'acme', secret: apiKey, metadata: { baseUrl: 'https://acme.example' } }],
      };
    },
  },
})
class Server {}
```

## What This Demonstrates

- Returning `credentials: [{ key, secret, metadata? }]` from `authenticate()` so FrontMCP persists them encrypted, keyed by the minted `sub`
- Reading a per-session credential from a tool via `this.credentials.get(key)` (no `this.authProviders` wiring needed)
- Prompting the agent to connect a missing credential mid-session with `this.credentials.requireConnect({ key })` (framework-signed `/oauth/connect` URL)
- Understanding per-session rotation: a reconnect yields an empty vault and old ciphertext is undecryptable

## Related

- See `configure-auth` for the full `this.credentials` API and the
  `authenticate()` verifier contract.
- See `remote-oauth-with-vault` for the separate `this.authProviders` downstream
  OAuth-provider vault.
