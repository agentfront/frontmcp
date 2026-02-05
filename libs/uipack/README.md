# @frontmcp/uipack

React-free build utilities, theming, runtime helpers, and platform adapters for FrontMCP UI development.

[![NPM](https://img.shields.io/npm/v/@frontmcp/uipack.svg)](https://www.npmjs.com/package/@frontmcp/uipack)

## Package Split

| Package            | Purpose                                                               | React Required |
| ------------------ | --------------------------------------------------------------------- | -------------- |
| `@frontmcp/uipack` | Themes, runtime helpers, build/render pipelines, validation, adapters | No             |
| `@frontmcp/ui`     | HTML/React components, layouts, widgets, web components               | Yes (peer dep) |

## Install

```bash
npm install @frontmcp/uipack
```

## Features

- **Theme system** — Tailwind-style palettes, fonts, CDN assets, platform-aware inlining ([docs][docs-theme])
- **Build API** — compile tool templates with esbuild/SWC, emit static widgets, cached manifests ([docs][docs-build])
- **Build modes** — static, dynamic, or hybrid rendering; multi-platform bundler helpers ([docs][docs-build-modes])
- **Runtime helpers** — wrap HTML/React/MDX with CSP, sanitize content, expose MCP Bridge metadata ([docs][docs-runtime])
- **Platform adapters** — OpenAI/Claude/Gemini discovery metadata, serving modes, host capabilities ([docs][docs-adapters])
- **Validation** — schema path extraction, Handlebars template validation, error boxes ([docs][docs-validation])
- **Bundler/cache** — filesystem and Redis caches, transpile/render caches, hashing utilities ([docs][docs-bundler])

## Quick Example

```ts
import { buildToolUI } from '@frontmcp/uipack/build';

const result = await buildToolUI({
  template: '<div>{{output.temperature}} C</div>',
  context: { input: { location: 'London' }, output: { temperature: 18 } },
  platform: 'openai',
});
```

> Full guide: [UI Overview][docs-overview]

## Entry Points

| Path                          | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `@frontmcp/uipack/theme`      | Theme system, platform definitions, CDN helpers          |
| `@frontmcp/uipack/runtime`    | MCP Bridge runtime, CSP utilities, sanitizers            |
| `@frontmcp/uipack/build`      | Build API, static widget compiler, serving-mode resolver |
| `@frontmcp/uipack/adapters`   | Discovery metadata + platform adapters                   |
| `@frontmcp/uipack/pages`      | Prebuilt page templates (consent/error/success)          |
| `@frontmcp/uipack/validation` | Component + template validation helpers                  |
| `@frontmcp/uipack/bundler`    | esbuild/SWC bundler and cache utilities                  |
| `@frontmcp/uipack/registry`   | Tool UI registry, URI helpers, render functions          |
| `@frontmcp/uipack/types`      | Shared template/context types                            |
| `@frontmcp/uipack/utils`      | Escaping, safe stringify, helper utilities               |

## Docs

| Topic             | Link                            |
| ----------------- | ------------------------------- |
| Overview          | [UI Overview][docs-overview]    |
| Theme system      | [Theming][docs-theme]           |
| Build API         | [Build Tools][docs-build]       |
| Build modes       | [Build Modes][docs-build-modes] |
| Runtime helpers   | [Runtime][docs-runtime]         |
| Platform adapters | [Adapters][docs-adapters]       |
| Validation        | [Validation][docs-validation]   |
| Bundler           | [Bundler][docs-bundler]         |

## Related Packages

- [`@frontmcp/ui`](../ui) — React components that consume these helpers
- [`@frontmcp/sdk`](../sdk) — core framework and decorators
- [`@frontmcp/testing`](../testing) — UI assertions for automated testing

## License

Apache-2.0 — see [LICENSE](../../LICENSE).

<!-- links -->

[docs-overview]: https://docs.agentfront.dev/frontmcp/ui/overview
[docs-theme]: https://docs.agentfront.dev/frontmcp/ui/theming
[docs-build]: https://docs.agentfront.dev/frontmcp/ui/build-tools
[docs-build-modes]: https://docs.agentfront.dev/frontmcp/ui/build-modes
[docs-runtime]: https://docs.agentfront.dev/frontmcp/ui/runtime
[docs-adapters]: https://docs.agentfront.dev/frontmcp/ui/adapters
[docs-validation]: https://docs.agentfront.dev/frontmcp/ui/validation
[docs-bundler]: https://docs.agentfront.dev/frontmcp/ui/bundler
