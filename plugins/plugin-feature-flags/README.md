# @frontmcp/plugin-feature-flags

Turns the tools, resources, resource templates, prompts, skills and agents of a [FrontMCP](https://frontmcp.dev) server
on and off with feature flags. Give an entry `featureFlag: 'bulk-export'`, and while that flag is off for the caller,
the entry is left out of every list and refused when called, so you can ship a capability to some users before
everyone. Flags come from fixed values, LaunchDarkly, Split, Unleash or your own adapter, and are evaluated for each
caller. Inside your code, `this.featureFlags` reads a flag.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-feature-flags.svg)](https://www.npmjs.com/package/@frontmcp/plugin-feature-flags) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-feature-flags.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugin-feature-flags
```

The plugin runs inside a FrontMCP server, so your app needs `@frontmcp/sdk`, at the same version as this package, and
Node.js 24 or later.

The flag services' SDKs are optional peer dependencies. Install the one for the adapter you use:

| `adapter`        | Install                                 |
| ---------------- | --------------------------------------- |
| `'launchdarkly'` | `@launchdarkly/node-server-sdk` (9, 10) |
| `'splitio'`      | `@splitsoftware/splitio` (10, 11)       |
| `'unleash'`      | `unleash-client` (5, 6)                 |

Without it, the server fails to start with an error such as
`LaunchDarkly SDK not found. Install it: npm install @launchdarkly/node-server-sdk`. The `'static'` and `'custom'`
adapters need nothing else.

## Usage

Register the plugin with `FeatureFlagPlugin.init()`, then gate entries with `featureFlag`:

```ts
import { FeatureFlagPlugin } from '@frontmcp/plugin-feature-flags';
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'bulk_export',
  description: 'Export every ticket as CSV',
  inputSchema: {},
  featureFlag: 'bulk-export',
})
class BulkExportTool extends ToolContext {
  async execute() {
    return { csv: 'id,title\nT-1,Cannot log in' };
  }
}

@Tool({ name: 'search_tickets', description: 'Search support tickets', inputSchema: { query: z.string() } })
class SearchTicketsTool extends ToolContext {
  async execute({ query }: { query: string }) {
    const ranking = (await this.featureFlags.isEnabled('semantic-search', false)) ? 'semantic' : 'keyword';
    return { query, ranking, tickets: ['T-1'] };
  }
}

@App({ id: 'help-desk', name: 'Help Desk', tools: [SearchTicketsTool, BulkExportTool] })
class HelpDeskApp {}

@FrontMcp({
  info: { name: 'help-desk', version: '1.0.0' },
  apps: [HelpDeskApp],
  plugins: [
    FeatureFlagPlugin.init({
      adapter: 'static',
      flags: { 'bulk-export': false, 'semantic-search': true },
    }),
  ],
})
export default class Server {}
```

Here `bulk_export` is left out of `tools/list`, and a call to it is refused with
`Tool "bulk_export" is disabled by feature flag "bulk-export"` and the code `FEATURE_FLAG_DISABLED`.

Registered on `@FrontMcp`, the plugin gates every app's entries. Registered on an `@App`, it gates that app's entries,
and those of any app without a feature-flag plugin of its own. If an entry declares `featureFlag` and no feature-flag
plugin reaches it, the server doesn't start.

## The `featureFlag` option

The plugin adds `featureFlag` to `@Tool`, `@Resource`, `@ResourceTemplate`, `@Prompt`, `@Skill` and `@Agent`:

| Form                    | Meaning                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'key'`                 | Gated by the flag `key`. When the adapter has no answer for it, the entry is off, unless the plugin's `gateDefaultValue` is `true`.                                    |
| `{ key, defaultValue }` | The same, except that `defaultValue` decides when the adapter has no answer for the flag, or throws while a call is checked. A flag the adapter reports off stays off. |

## Options

`adapter` picks where flags come from, and which other option it needs:

| `adapter`        | Also required                                          | Flags come from      |
| ---------------- | ------------------------------------------------------ | -------------------- |
| `'static'`       | `flags: Record<string, boolean \| FeatureFlagVariant>` | The values you give. |
| `'launchdarkly'` | `config: { sdkKey }`                                   | LaunchDarkly.        |
| `'splitio'`      | `config: { apiKey }`                                   | Split.               |
| `'unleash'`      | `config: { url, appName, apiKey? }`                    | Unleash.             |
| `'custom'`       | `adapterInstance: FeatureFlagAdapter`                  | Your adapter.        |

Every adapter also takes:

| Option               | Type                                                | Default            | Description                                                                                                                                          |
| -------------------- | --------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultValue`       | `boolean`                                           | `false`            | What `this.featureFlags.isEnabled()` returns, when the call passes no default, for an unknown flag or an error.                                      |
| `gateDefaultValue`   | `boolean`                                           | `false`            | What lists and gates answer for an unknown flag, or an error during a call, when the entry's `featureFlag` has no `defaultValue`. `true` fails open. |
| `cacheStrategy`      | `'session' \| 'request' \| 'none'`                  | `'none'`           | Caches `this.featureFlags.isEnabled()` results. Lists and gates never cache.                                                                         |
| `cacheTtlMs`         | `number`                                            | `30000`            | How long a cached result lasts, in milliseconds.                                                                                                     |
| `userIdResolver`     | `(ctx: FrontMcpContext) => string \| undefined`     | the signed-in user | The `userId` adapters evaluate flags for. An anonymous caller has none.                                                                              |
| `attributesResolver` | `(ctx: FrontMcpContext) => Record<string, unknown>` | `{}`               | Targeting attributes, such as a tenant or a plan.                                                                                                    |

`FeatureFlagPlugin.init()` without a supported `adapter` throws a `FeatureFlagConfigurationError`.

```ts
FeatureFlagPlugin.init({
  adapter: 'launchdarkly',
  config: { sdkKey: process.env.LAUNCHDARKLY_SDK_KEY! },
  attributesResolver: (ctx) => ({ plan: ctx.authInfo?.extra?.['plan'] }),
});
```

### Your own adapter

Pass any object that implements `FeatureFlagAdapter` as `adapterInstance`. Here `flagService` stands for your flag
service's client:

```ts
import { FeatureFlagPlugin, type FeatureFlagAdapter } from '@frontmcp/plugin-feature-flags';

const flagAdapter: FeatureFlagAdapter = {
  async isEnabled(flagKey, context) {
    return (await flagService.isOn(flagKey, context.userId)) === true;
  },
  async getVariant(flagKey, context) {
    const enabled = (await flagService.isOn(flagKey, context.userId)) === true;
    return { name: enabled ? 'on' : 'off', value: enabled, enabled };
  },
  async evaluateFlags(flagKeys, context) {
    const results = new Map<string, boolean>();
    for (const flagKey of flagKeys) {
      const answer = await flagService.isOn(flagKey, context.userId);
      if (answer !== undefined) results.set(flagKey, answer);
    }
    return results;
  },
};

FeatureFlagPlugin.init({ adapter: 'custom', adapterInstance: flagAdapter });
```

- `evaluateFlags()` is what lists, gates and `this.featureFlags.isEnabled()` call. Leave out a key you know nothing
  about, so the caller's `defaultValue` applies; answer `false` for a flag that's off.
- `getVariant()` serves `this.featureFlags.getVariant()`. `isEnabled()` is required, though the plugin doesn't call it.
- The optional `initialize()` runs when the server starts, and `destroy()` when it's disposed.

The built-in adapters are exported too: `StaticFeatureFlagAdapter`, `LaunchDarklyFeatureFlagAdapter`,
`SplitioFeatureFlagAdapter` and `UnleashFeatureFlagAdapter`.

## `this.featureFlags`

`this.featureFlags` is available in tools, resources and prompts, and evaluates flags for the current caller:

| Method                              | Returns                         | Description                                                                                                  |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `isEnabled(flagKey, defaultValue?)` | `Promise<boolean>`              | The flag's value. For an unknown flag, or an adapter error: `defaultValue`, else the plugin's, else `false`. |
| `getVariant(flagKey)`               | `Promise<FeatureFlagVariant>`   | The flag's variant, `{ name, value, enabled }`. Adapter errors are thrown.                                   |
| `evaluateFlags(flagKeys)`           | `Promise<Map<string, boolean>>` | Several flags in one adapter call. Adapter errors are thrown.                                                |
| `resolveRef(ref)`                   | `Promise<boolean>`              | The value of a `featureFlag` ref: a key, or `{ key, defaultValue }`.                                         |

`this.get(FeatureFlagAccessorToken)` returns the same accessor, and `this.tryGet(FeatureFlagAccessorToken)` returns it
or `undefined` where the plugin isn't installed.

## When the flag service fails

| Where                             | What happens when the adapter throws                                          |
| --------------------------------- | ----------------------------------------------------------------------------- |
| A list, such as `tools/list`      | The whole request fails with the adapter's error. No default applies.         |
| A gate, such as `tools/call`      | The ref's `defaultValue`, else the plugin's `gateDefaultValue`, else `false`. |
| `this.featureFlags.isEnabled()`   | The call's `defaultValue`, else the plugin's `defaultValue`, else `false`.    |
| `getVariant()`, `evaluateFlags()` | The error is thrown to your code.                                             |

If an outage mustn't take your lists down, catch errors inside a custom adapter and answer from a last known value.

## Docs

- [Feature flags plugin reference](https://frontmcp.dev/reference/plugins/feature-flags): every option, each adapter,
  targeting, and troubleshooting.
- [Turning features on and off](https://frontmcp.dev/learn/turning-features-on-and-off): a step-by-step guide.

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the FrontMCP framework this plugin runs in.
- [`@frontmcp/plugin-approval`](https://www.npmjs.com/package/@frontmcp/plugin-approval): refuses a tool until an
  approval is recorded for the caller.

## Contributing

Source:
[`plugins/plugin-feature-flags`](https://github.com/agentfront/frontmcp/tree/main/plugins/plugin-feature-flags). Issues
and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
