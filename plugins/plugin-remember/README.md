# @frontmcp/plugin-remember

Gives the tools of a [FrontMCP](https://frontmcp.dev) server a small encrypted key-value memory, `this.remember`, so a
tool can store something on one call and read it on a later one: a user's language, a draft, the last record they
opened. Values are encrypted before they're stored, in memory, Redis or Vercel KV. Each value lives in a scope
(`session`, `user`, `tool` or `global`) that decides who can read it back. Turn on `tools.enabled` and the plugin also
gives the model four tools to remember things itself.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-remember.svg)](https://www.npmjs.com/package/@frontmcp/plugin-remember) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-remember.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugin-remember
```

The plugin runs inside a FrontMCP server, so your app needs `@frontmcp/sdk`, at the same version as this package, and
Node.js 24 or later. Its peer dependency `@frontmcp/lazy-zod` comes with the SDK.

For the Vercel KV store (`type: 'vercel-kv'`, or `'global-store'` with a Vercel KV provider), also install the optional
peer `@vercel/kv`. The Redis stores use `ioredis`, which is already a dependency.

## Usage

Register the plugin with `RememberPlugin.init()` in the `plugins` of `@FrontMcp` (every app) or of one `@App` (that
app only). Importing the package also tells TypeScript about `this.remember`.

```ts
import { RememberPlugin } from '@frontmcp/plugin-remember';
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'set_language',
  description: 'Set the language the user wants answers in',
  inputSchema: { language: z.string() },
})
class SetLanguageTool extends ToolContext {
  async execute({ language }: { language: string }) {
    await this.remember.set('language', language, { scope: 'user' });
    return { language };
  }
}

@Tool({ name: 'get_language', description: 'The language the user wants answers in', inputSchema: {} })
class GetLanguageTool extends ToolContext {
  async execute() {
    const language = await this.remember.get('language', { scope: 'user', defaultValue: 'en' });
    return { language };
  }
}

@App({ id: 'preferences', name: 'Preferences', tools: [SetLanguageTool, GetLanguageTool] })
class PreferencesApp {}

@FrontMcp({
  info: { name: 'assistant', version: '1.0.0' },
  apps: [PreferencesApp],
  plugins: [RememberPlugin.init({ type: 'memory' })],
})
export default class Server {}
```

`user` scope needs a signed-in caller. An anonymous caller is refused with `RememberIdentityError`; see
[Scopes](#scopes).

## Options

Every option is optional. `RememberPlugin.init()` and `plugins: [RememberPlugin]` both keep values in memory.

| Option                 | Type                                                                     | Default                                | Description                                                                                     |
| ---------------------- | ------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `type`                 | `'memory' \| 'redis' \| 'redis-client' \| 'vercel-kv' \| 'global-store'` | `'memory'`                             | Where values are kept. See [Stores](#stores).                                                   |
| `keyPrefix`            | `string`                                                                 | `'remember:'`                          | Starts every key in the store. Give each server its own when several share a Redis.             |
| `defaultTTL`           | `number` (seconds)                                                       |                                        | How long a value set without `ttl` lives. A whole number; `0` means no default expiry.          |
| `encryption.enabled`   | `boolean`                                                                | `true`                                 | Encrypt values before they're stored. With `false`, values are stored as plain JSON.            |
| `encryption.customKey` | `string`                                                                 |                                        | The secret keys are derived from, in place of `REMEMBER_SECRET`. See [Encryption](#encryption). |
| `config`               | `{ host, port, password?, db? }`                                         |                                        | With `type: 'redis'`: where to connect.                                                         |
| `client`               | `Redis` (ioredis)                                                        |                                        | With `type: 'redis-client'`: a client you created.                                              |
| `url`, `token`         | `string`                                                                 | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | With `type: 'vercel-kv'`: the store's REST URL and token.                                       |
| `tools.enabled`        | `boolean`                                                                | `false`                                | Register the [memory tools](#memory-tools).                                                     |
| `tools.prefix`         | `string`                                                                 |                                        | Starts the memory tools' names: `'memory_'` gives `memory_recall`, and so on.                   |
| `tools.allowedScopes`  | `RememberScope[]`                                                        | all four                               | Which scopes the memory tools accept. Another scope fails with `RememberScopeNotAllowedError`.  |
| `skipLegacyPurge`      | `boolean`                                                                | `false`                                | Don't delete entries written by older versions of the plugin, whose keys can no longer be read. |
| `legacyPurgeDelayMs`   | `number`                                                                 | `86400000` (24 hours)                  | How long after the current key layout first reached the store to wait before that purge.        |

### Stores

| `type`           | Where values live                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `'memory'`       | A `Map` in the server's process. Lost on restart, and not shared between instances.                  |
| `'redis'`        | A Redis server the plugin connects to with `config`.                                                 |
| `'redis-client'` | Your own `ioredis` client, in `client`.                                                              |
| `'vercel-kv'`    | Vercel KV, through `@vercel/kv`.                                                                     |
| `'global-store'` | The store in `@FrontMcp({ redis })`: Redis, or Vercel KV. Without `redis`, the server doesn't start. |

## `this.remember`

`this.remember` is available in tools, resources, prompts and agents. Every method takes a `scope` option, which
defaults to `'session'`.

| Method                         | Returns                               | Description                                                                                                             |
| ------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `set(key, value, options?)`    | `Promise<RememberEntry>`              | Stores a JSON-serializable `value`. Options: `scope`, `ttl` (seconds), `brand`, `metadata`.                             |
| `get(key, options?)`           | `Promise<T \| undefined>`             | The value, or `options.defaultValue` when there is none or it expired.                                                  |
| `getEntry(key, options?)`      | `Promise<RememberEntry \| undefined>` | The value with its `brand`, `metadata`, `createdAt`, `updatedAt` and `expiresAt`.                                       |
| `update(key, value, options?)` | `Promise<boolean>`                    | Replaces the value, keeping its metadata, and its expiry unless you pass `ttl`. `false` when there's nothing to update. |
| `knows(key, options?)`         | `Promise<boolean>`                    | Whether `get()` would find a value.                                                                                     |
| `forget(key, options?)`        | `Promise<void>`                       | Deletes the value.                                                                                                      |
| `list(options?)`               | `Promise<string[]>`                   | The keys in a scope. `options.pattern` filters them with `*` and `?`.                                                   |

`this.get(RememberAccessorToken)` returns the same accessor, and `this.tryGet(RememberAccessorToken)` returns it or
`undefined` where the plugin isn't installed.

## Scopes

| Scope               | Who can read a value back                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `session` (default) | The same session, as the server verified it. Without a verified session, the same signed-in caller. |
| `user`              | The same signed-in caller, across sessions.                                                         |
| `tool`              | The same caller as `session`, and only from the tool that stored it.                                |
| `global`            | Every caller.                                                                                       |

A scope with no caller to keep values apart throws `RememberIdentityError`: `user` scope for an anonymous caller, and
`session` or `tool` scope for an anonymous caller without a verified session. Under MCP 2026-07-28, which has no
sessions, `session` values belong to the signed-in caller and last across all their requests, so give
conversation-sized state a `ttl`.

## Encryption

With encryption on (the default), each value is encrypted with AES-256-GCM, with a key derived (HKDF-SHA256) from a
server secret and the scope's identity. The server secret is `encryption.customKey` when you set it, otherwise:

1. `REMEMBER_SECRET`, `MCP_MEMORY_SECRET` or `MCP_SESSION_SECRET` from the environment.
2. Outside production (`NODE_ENV` isn't `production`): a secret the plugin generates and saves to
   `.frontmcp/remember-secret.json`. Keep `.frontmcp/` out of version control.
3. In production: a random secret for this process, with a warning. Values can't be read after a restart, or by
   another instance.

Set `REMEMBER_SECRET`, or `encryption.customKey`, to the same value on every instance that shares a store.

## Memory tools

With `tools.enabled: true`, the plugin registers four tools, named with `tools.prefix` if you set one:

| Tool            | Arguments                                                |
| --------------- | -------------------------------------------------------- |
| `remember_this` | `key`, `value`, `scope?`, `ttl?`, `brand?`               |
| `recall`        | `key`, `scope?`                                          |
| `forget`        | `key`, `scope?`                                          |
| `list_memories` | `scope?`, `pattern?`, `limit?` (default 50, at most 100) |

The package also exports their classes, `RememberThisTool`, `RecallTool`, `ForgetTool` and `ListMemoriesTool`, to list
in an app's `tools` yourself. Use one way or the other, not both.

## Docs

- [Remember plugin reference](https://frontmcp.dev/reference/plugins/remember): every option, scope and error.
- [Remembering across calls](https://frontmcp.dev/learn/remembering-across-calls): a step-by-step guide.
- [Redis](https://frontmcp.dev/reference/deployment/redis): the `@FrontMcp({ redis })` store that `type: 'global-store'`
  uses.

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the FrontMCP framework this plugin runs in.
- [`@frontmcp/plugin-approval`](https://www.npmjs.com/package/@frontmcp/plugin-approval): refuses a tool until an
  approval is recorded for the caller. Tool approval lives there, not in this plugin.
- [`@frontmcp/plugin-cache`](https://www.npmjs.com/package/@frontmcp/plugin-cache): caches tool results.
- [`@frontmcp/plugins`](https://www.npmjs.com/package/@frontmcp/plugins): re-exports this plugin with other official
  plugins.

## Contributing

Source: [`plugins/plugin-remember`](https://github.com/agentfront/frontmcp/tree/main/plugins/plugin-remember). Issues
and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
