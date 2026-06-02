---
name: local-secure-store
reference: configure-auth
level: intermediate
description: 'Configure the general session secure-secret store (this.secureStore) with a pluggable backing (memory / sqlite / redis / custom OS-keychain) and read/write user-typed secrets from a tool.'
tags: [config, auth, local, secure-store, secrets, this-secure-store, keychain]
features:
  - 'Selecting the secure-store backing via `auth.secureStore` (memory / sqlite / redis / custom backend) plus a namespace `scope`'
  - 'Reading/writing arbitrary user-typed secrets from a tool via `this.secureStore.set/get/list/delete` (JSON-serialized, scoped to the session/subject)'
  - 'Backing the store with an OS keychain by supplying a `SecureStoreBackend` — no native dependency is bundled by the framework'
  - 'Understanding scope: `user` (keyed by sub, default), `session` (keyed by sessionId), `global` (server-wide)'
---

# Local Mode with the Session Secure-Secret Store (`this.secureStore`)

Configure the general session secure-secret store (this.secureStore) with a pluggable backing (memory / sqlite / redis / custom OS-keychain) and read/write user-typed secrets from a tool.

The store is distinct from `this.credentials` (which is OAuth-credential-centric):
use `this.secureStore` for arbitrary secrets like an API key a tool prompts for.
The built-in backings encrypt at rest with AES-256-GCM, and an OS keychain can be
plugged in without the framework bundling any native dependency.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z, type SecureStoreConfig } from '@frontmcp/sdk';

@Tool({
  name: 'set_api_key',
  description: 'Store a user-typed API key in the session secure store',
  inputSchema: { apiKey: z.string() },
  outputSchema: { saved: z.boolean(), keys: z.array(z.string()) },
})
class SetApiKeyTool extends ToolContext {
  async execute(input: { apiKey: string }) {
    // Values are JSON-serialized and encrypted at rest (built-in backings),
    // scoped to the current `sub` (user scope, the default).
    await this.secureStore.set('stg.api-key', input.apiKey);
    const keys = await this.secureStore.list();
    return { saved: true, keys };
  }
}

@Tool({
  name: 'read_api_key',
  description: 'Read the stored API key (presence only — never returns the raw secret)',
  inputSchema: {},
  outputSchema: { present: z.boolean() },
})
class ReadApiKeyTool extends ToolContext {
  async execute() {
    const apiKey = await this.secureStore.get<string>('stg.api-key');
    // Never return the raw secret to the model — only presence.
    return { present: apiKey !== undefined };
  }
}

@App({ name: 'Secrets', tools: [SetApiKeyTool, ReadApiKeyTool] })
class SecretsApp {}

// Pick the backing per deployment. Default ('memory') is encrypted in-process.
const secureStore: SecureStoreConfig = {
  sqlite: { path: './.frontmcp/secrets.sqlite' }, // survives restart
  scope: 'user', // 'user' (default) | 'session' | 'global'
};

@FrontMcp({
  info: { name: 'secure-store-demo', version: '0.1.0' },
  apps: [SecretsApp],
  auth: {
    mode: 'local',
    secureStore,
    login: {
      title: 'Sign in',
      fields: { apiKey: { type: 'password', label: 'API Key', required: true } },
      subject: { fromField: 'apiKey', strategy: 'per-account' },
    },
    authenticate: async (input) => {
      if (!input.fields['apiKey']) return { ok: false, message: 'API key required', retryField: 'apiKey' };
      return { ok: true };
    },
  },
})
export default class Server {}
```

## What This Demonstrates

- Selecting the secure-store backing via `auth.secureStore` (memory / sqlite / redis / custom backend) plus a namespace `scope`
- Reading/writing arbitrary user-typed secrets from a tool via `this.secureStore.set/get/list/delete` (JSON-serialized, scoped to the session/subject)
- Backing the store with an OS keychain by supplying a `SecureStoreBackend` — no native dependency is bundled by the framework
- Understanding scope: `user` (keyed by sub, default), `session` (keyed by sessionId), `global` (server-wide)

## Optional: back the store with an OS keychain (pluggable, not bundled)

FrontMCP does **not** ship `keytar`/`wincred`/`libsecret`. Supply an object
implementing `SecureStoreBackend` and the framework uses it as-is (no framework
crypto — an OS keychain is encrypted by the OS):

```typescript
import type { SecureStoreBackend } from '@frontmcp/sdk';

// import keytar from 'keytar'; // YOU add the native peer-dep

const keychainBackend: SecureStoreBackend = {
  async get(namespace, key) {
    return (await keytar.getPassword(`frontmcp:${namespace}`, key)) ?? null;
  },
  async set(namespace, key, value /*, ttlMs */) {
    await keytar.setPassword(`frontmcp:${namespace}`, key, value); // ttlMs ignored
  },
  async delete(namespace, key) {
    return keytar.deletePassword(`frontmcp:${namespace}`, key);
  },
  async list(/* namespace */) {
    const creds = await keytar.findCredentials('frontmcp');
    return creds.map((c) => c.account);
  },
};

// auth: { mode: 'local', secureStore: { backend: keychainBackend, scope: 'global' } }
```

## Notes

- **Backings**: `'memory'` (default, encrypted in-process), `{ sqlite: { path } }`,
  `{ redis: { ... } }`, or `{ backend }` (custom). The persistent built-ins reuse
  the same `StorageAdapter`/`VaultEncryption` as `tokenStorage`; when the backing
  matches `tokenStorage` the same connection is shared.
- **Scope**: `user` keys by `sub` (anonymous requests read empty / skip writes),
  `session` keys by `sessionId`, `global` shares one server-wide namespace. The
  identity is hashed into the namespace — never stored raw.
- **API**: `get<T>(key)`, `set<T>(key, value, { ttlMs? })`, `delete(key)`,
  `list()`. Object configs also accept `ttlMs` and `encryption.pepper`
  (overrides `VAULT_SECRET ?? JWT_SECRET`).
- **Never return raw secrets to the model** — expose presence/redacted previews
  only, as `read_api_key` does above.
