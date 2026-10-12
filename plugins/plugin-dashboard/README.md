# @frontmcp/plugin-dashboard

A FrontMCP add-on that shows a server's apps, tools, resources and prompts in a browser, as a graph. Use it while
you build a server, to see what it serves. It has two parts: `DashboardApp`, which you add to `apps` and which
serves the dashboard, and `DashboardPlugin`, which sets its options. It runs on FrontMCP's Node HTTP server.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-dashboard.svg)](https://www.npmjs.com/package/@frontmcp/plugin-dashboard) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-dashboard.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugin-dashboard @frontmcp/sdk
```

Requires Node.js 24 or later. Keep `@frontmcp/sdk` on the same version as this package.

## Usage

Add `DashboardApp` to `apps`, and register `DashboardPlugin.init()` for its options:

```ts
import { DashboardApp, DashboardPlugin } from '@frontmcp/plugin-dashboard';
import { App, FrontMcp } from '@frontmcp/sdk';

@App({ id: 'help-desk', name: 'Help Desk' })
class HelpDeskApp {}

@FrontMcp({
  info: { name: 'help-desk', version: '1.0.0' },
  apps: [HelpDeskApp, DashboardApp],
  plugins: [DashboardPlugin.init({ auth: { enabled: true, token: process.env.DASHBOARD_TOKEN } })],
})
export default class Server {}
```

Then open `/dashboard` on the server's port (`PORT`, else 3000), with the token as `Authorization: Bearer <token>` or
`?token=<token>`. The page then sets a cookie that its own requests send.

- **`GET /dashboard`** answers with an HTML page that loads React, React Flow and dagre from `esm.sh`, so the browser
  needs internet access.
- **`/dashboard`** is also an MCP endpoint of its own, with three tools that describe the whole server:
  `dashboard:graph`, `dashboard:list-tools` and `dashboard:list-resources`. They aren't listed at the server's main
  endpoint. The page reads from them.
- **`DashboardPlugin.init()` alone serves nothing.** `DashboardApp` serves the dashboard, with the default options
  when there's no plugin.
- **It's off in production.** Unless you set `enabled`, the dashboard is on when `NODE_ENV` isn't `production`, and
  answers `404` when it is. To use it in production, set `enabled: true` with `auth`.

## Options

| Option                       | Default                               | Description                                                                                                                                                     |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                    | On, unless `NODE_ENV` is `production` | Serve the dashboard.                                                                                                                                            |
| `basePath`                   | `'/dashboard'`                        | Where the page is served.                                                                                                                                       |
| `auth.enabled`, `auth.token` | Off                                   | Require the token for the page and the MCP endpoint, and answer `401` without it. `enabled` without `token` makes `init()` throw.                               |
| `cdn`                        | `esm.sh` URLs                         | Where the page loads its libraries from: `entrypoint`, `react`, `reactDom`, `reactDomClient`, `reactJsxRuntime`, `reactRouter`, `xyflow`, `dagre`, `xyflowCss`. |

The dashboard's MCP endpoint applies the server's own authentication first, then the dashboard's `auth`. On a server
with its own authentication, send the dashboard token in the `x-frontmcp-dashboard-token` header.

Dashboard options apply to the whole process: a second `DashboardPlugin.init()` with a different `auth` throws, and
one with other differences replaces the first for every server, with a warning.

## Docs

- [The dashboard](https://frontmcp.dev/reference/plugins#the-dashboard): options, tokens, and the MCP endpoint
- [Plugins and adapters](https://frontmcp.dev/reference/plugins): every official plugin, and where to register it

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework this add-on extends
- [`@frontmcp/plugins`](https://www.npmjs.com/package/@frontmcp/plugins): a meta-package that re-exports
  `DashboardApp` and `DashboardPlugin` with three other plugins

## Contributing

Source: [`plugins/plugin-dashboard`](https://github.com/agentfront/frontmcp/tree/main/plugins/plugin-dashboard).
Issues and pull requests are welcome; see
[CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
