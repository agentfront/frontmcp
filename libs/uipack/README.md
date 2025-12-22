# @frontmcp/uipack

React-free build utilities, theming, runtime helpers, and platform adapters for FrontMCP UI development. `@frontmcp/uipack` powers HTML string templates, cacheable widgets, and discovery metadata without pulling React or DOM libraries into your server.

## Package Split

| Package            | Purpose                                                               | React Required        |
| ------------------ | --------------------------------------------------------------------- | --------------------- |
| `@frontmcp/uipack` | Themes, runtime helpers, build/render pipelines, validation, adapters | No                    |
| `@frontmcp/ui`     | HTML/React components, layouts, widgets, web components               | Yes (peer dependency) |

Install `@frontmcp/uipack` when you need HTML-first tooling, template validation, or platform adapters. Install `@frontmcp/ui` alongside it for ready-made components.

## Installation

```bash
npm install @frontmcp/uipack
# or
yarn add @frontmcp/uipack
```

## Features

- **Theme system** – Configure Tailwind-style palettes, fonts, and CDN assets, then inline or externalize scripts per platform.
- **Build API** – Compile tool templates with esbuild/SWC, emit static widgets, and ship cached manifests for serverless environments.
- **Runtime helpers** – Wrap HTML/React/MDX templates with CSP, sanitize user content, and expose MCP Bridge metadata.
- **Platform adapters** – Generate OpenAI/Claude/Gemini discovery metadata, resolve serving modes, and understand host capabilities.
- **Validation** – Extract schema paths, validate Handlebars templates, and render error boxes before code hits production.
- **Bundler/cache** – File-system and Redis caches, transpile/render caches, and hashing utilities for incremental builds.

## Quick Start

### Theme + layout utilities

```ts
import { DEFAULT_THEME, createTheme, buildCdnScriptsFromTheme } from '@frontmcp/uipack/theme';

const customTheme = createTheme({
  name: 'brand',
  colors: {
    semantic: {
      primary: '#0BA5EC',
      secondary: '#6366F1',
    },
  },
});

const scripts = await buildCdnScriptsFromTheme(customTheme, { inline: true });
```

### Build tool UI HTML

```ts
import { buildToolUI } from '@frontmcp/uipack/build';

const result = await buildToolUI({
  template: '<div>{{output.temperature}} °C</div>',
  context: {
    input: { location: 'London' },
    output: { temperature: 18 },
  },
  platform: 'openai',
});

console.log(result.html);
```

### Wrap tool responses with MCP metadata

```ts
import { wrapToolUI, createTemplateHelpers } from '@frontmcp/uipack/runtime';

The helpers = createTemplateHelpers();
const html = `<div>${helpers.escapeHtml(ctx.output.summary)}</div>`;

const response = wrapToolUI({
  html,
  displayMode: 'inline',
  servingMode: 'auto',
  widgetDescription: 'Summarized status card',
});
```

### Resolve platform capabilities

```ts
import { getPlatform, canUseCdn, needsInlineScripts } from '@frontmcp/uipack/theme';

const claude = getPlatform('claude');
const inline = needsInlineScripts(claude);
const cdnOk = canUseCdn(claude);
```

## Entry points

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

## Template validation

```ts
import { validateTemplate } from '@frontmcp/uipack/validation';
import { z } from 'zod';

const outputSchema = z.object({
  temperature: z.number(),
  city: z.string(),
});

const result = validateTemplate('<div>{{output.city}}</div>', outputSchema);
if (!result valid) {
  console.warn(result.errors);
}
```

## Cache + bundler helpers

```ts
import { createFilesystemBuilder } from '@frontmcp/uipack/bundler/file-cache';

const builder = await createFilesystemBuilder('.frontmcp-cache/builds');
const manifest = await builder.build({ entry: './widgets/weather.tsx' });
```

## Development

```bash
yarn nx build uipack
yarn nx test uipack
```

## Related packages

- [`@frontmcp/ui`](../ui/README.md) – Component library that consumes these helpers
- [`@frontmcp/sdk`](../sdk/README.md) – Core SDK and decorators
- [`@frontmcp/testing`](../testing/README.md) – UI assertions for automated testing

## License

Apache-2.0
