# @frontmcp/ui

Platform-aware UI toolkit for building HTML widgets, React components, and web components inside MCP transports.

[![NPM](https://img.shields.io/npm/v/@frontmcp/ui.svg)](https://www.npmjs.com/package/@frontmcp/ui)

## Package Split

| Package            | Purpose                                                         | React Required |
| ------------------ | --------------------------------------------------------------- | -------------- |
| `@frontmcp/ui`     | HTML components, React components/hooks, SSR renderers          | Yes (peer dep) |
| `@frontmcp/uipack` | Themes, build/render pipelines, runtime helpers, template types | No             |

## Install

```bash
npm install @frontmcp/ui @frontmcp/uipack react react-dom
```

## Features

- **HTML-first components** — buttons, cards, badges, alerts, forms, tables, layouts that return ready-to-stream HTML ([docs][docs-components])
- **React components** — `Button`, `Card`, `Alert`, `Badge` with TypeScript props ([docs][docs-react])
- **MCP Bridge hooks** — `useMcpBridge`, `useCallTool`, `useToolInput`, `useToolOutput` ([docs][docs-hooks])
- **SSR + hydration** — `ReactRenderer` for server-side rendering, `ReactRendererAdapter` for client hydration ([docs][docs-ssr])
- **MDX rendering** — server-side MDX-to-HTML with component resolution ([docs][docs-mdx])
- **Web components** — `<fmcp-button>`, `<fmcp-card>`, and friends as custom elements ([docs][docs-web-components])
- **Universal app shell** — `FrontMCPProvider` + `UniversalApp` for platform-agnostic React apps ([docs][docs-universal])
- **SSR bundling** — `InMemoryBundler` for component compilation ([docs][docs-bundling])

## Quick Example

```ts
import { card, button } from '@frontmcp/ui/components';
import { baseLayout } from '@frontmcp/ui/layouts';
import { DEFAULT_THEME } from '@frontmcp/uipack/theme';

const html = baseLayout(card(`<h2>Hello</h2>${button('Submit', { variant: 'primary' })}`, { variant: 'elevated' }), {
  title: 'My Widget',
  theme: DEFAULT_THEME,
});
```

> Full guide: [UI Overview][docs-overview]

## Entry Points

| Path                          | Exports                               |
| ----------------------------- | ------------------------------------- |
| `@frontmcp/ui/components`     | HTML components, helpers, error boxes |
| `@frontmcp/ui/layouts`        | Base layouts, consent/error templates |
| `@frontmcp/ui/pages`          | High-level page templates             |
| `@frontmcp/ui/widgets`        | OpenAI App SDK-style widgets          |
| `@frontmcp/ui/react`          | React components + hooks              |
| `@frontmcp/ui/renderers`      | ReactRenderer, MdxRenderer, adapters  |
| `@frontmcp/ui/render`         | React 19 static rendering utilities   |
| `@frontmcp/ui/web-components` | `<fmcp-*>` custom elements            |
| `@frontmcp/ui/bridge`         | Bridge registry + adapters            |
| `@frontmcp/ui/bundler`        | SSR/component bundler                 |

## Docs

| Topic            | Link                                  |
| ---------------- | ------------------------------------- |
| Overview         | [UI Overview][docs-overview]          |
| HTML components  | [Components][docs-components]         |
| React components | [React][docs-react]                   |
| MCP Bridge hooks | [Hooks][docs-hooks]                   |
| SSR rendering    | [SSR][docs-ssr]                       |
| MDX rendering    | [MDX][docs-mdx]                       |
| Web components   | [Web Components][docs-web-components] |
| Universal app    | [Universal App][docs-universal]       |
| Bundling         | [Bundling][docs-bundling]             |

## Related Packages

- [`@frontmcp/uipack`](../uipack) — React-free themes, runtime helpers, build tooling
- [`@frontmcp/sdk`](../sdk) — core framework
- [`@frontmcp/testing`](../testing) — UI assertions (`toHaveRenderedHtml`, `toBeXssSafe`)

## License

Apache-2.0 — see [LICENSE](../../LICENSE).

<!-- links -->

[docs-overview]: https://docs.agentfront.dev/frontmcp/ui/overview
[docs-components]: https://docs.agentfront.dev/frontmcp/ui/components
[docs-react]: https://docs.agentfront.dev/frontmcp/ui/react
[docs-hooks]: https://docs.agentfront.dev/frontmcp/ui/hooks
[docs-ssr]: https://docs.agentfront.dev/frontmcp/ui/ssr
[docs-mdx]: https://docs.agentfront.dev/frontmcp/ui/mdx
[docs-web-components]: https://docs.agentfront.dev/frontmcp/ui/web-components
[docs-universal]: https://docs.agentfront.dev/frontmcp/ui/universal
[docs-bundling]: https://docs.agentfront.dev/frontmcp/ui/bundling
