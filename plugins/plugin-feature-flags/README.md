# @frontmcp/plugin-feature-flags

Gate MCP capabilities behind feature flags — hide tools, branch behaviour, and
roll out changes per user without redeploying.

[![NPM](https://img.shields.io/npm/v/@frontmcp/plugin-feature-flags.svg)](https://www.npmjs.com/package/@frontmcp/plugin-feature-flags)

## Install

```bash
npm install @frontmcp/plugin-feature-flags
```

## Usage

```ts
import { FeatureFlagPlugin } from '@frontmcp/plugin-feature-flags';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  plugins: [
    FeatureFlagPlugin.configure({
      provider: 'static',
      flags: { 'new-search': true, 'beta-export': false },
    }),
  ],
})
class Server {}
```

Then read flags from any tool through `this.featureFlags`:

```ts
@Tool({ name: 'search', inputSchema: { q: z.string() } })
export default class SearchTool extends ToolContext {
  async execute({ q }: { q: string }) {
    if (await this.featureFlags.isEnabled('new-search')) {
      return newSearch(q);
    }
    return legacySearch(q);
  }
}
```

## Providers

| Provider     | `provider`       | Notes                                            |
| ------------ | ---------------- | ------------------------------------------------ |
| Static       | `'static'`       | Flags from config. Good for local dev and tests. |
| Split.io     | `'splitio'`      | Requires an SDK key.                             |
| LaunchDarkly | `'launchdarkly'` | Requires an SDK key.                             |
| Unleash      | `'unleash'`      | Requires a URL + API token.                      |
| Custom       | `'custom'`       | Supply your own `FeatureFlagAdapter`.            |

```ts
FeatureFlagPlugin.configure({
  provider: 'launchdarkly',
  sdkKey: process.env.LD_SDK_KEY,
  // Which identity the flag is evaluated for. Defaults to the session's user.
  userIdResolver: (ctx) => ctx.authInfo?.clientId,
  attributesResolver: (ctx) => ({ plan: ctx.authInfo?.extra?.plan }),
});
```

### Custom adapter

```ts
import { FeatureFlagPlugin, type FeatureFlagAdapter } from '@frontmcp/plugin-feature-flags';

const adapter: FeatureFlagAdapter = {
  async isEnabled(key, ctx) {
    return myBackend.check(key, ctx.userId);
  },
};

FeatureFlagPlugin.configure({ provider: 'custom', adapter });
```

## API

`this.featureFlags` (an injected `FeatureFlagAccessor`):

| Method                     | Returns                         | Purpose                                       |
| -------------------------- | ------------------------------- | --------------------------------------------- |
| `isEnabled(key, default?)` | `Promise<boolean>`              | Evaluate one boolean flag                     |
| `getVariant(key)`          | `Promise<FeatureFlagVariant>`   | Multivariate flag value                       |
| `evaluateFlags(keys)`      | `Promise<Map<string, boolean>>` | Batch evaluation in one round trip            |
| `resolveRef(ref)`          | `Promise<boolean>`              | Resolve a flag reference (`{ flag, negate }`) |

Outside a tool, use `getFeatureFlags()` / `tryGetFeatureFlags()`.

## Failure behaviour

If the provider is unreachable, `isEnabled` returns the `defaultValue` you pass
(or `false`). Always pass an explicit default for a flag that gates something
important, so an outage degrades the way you intend rather than silently
disabling a feature.

Full guide: [Feature Flags](https://docs.agentfront.dev/frontmcp/plugins/feature-flags-plugin)

## License

Apache-2.0
