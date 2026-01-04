# @frontmcp/uipack - Development Guidelines

## Overview

`@frontmcp/uipack` provides **bundling, build tools, platform adapters, and theming** for MCP UI development - all without requiring React.

This is the React-free core package. For React components and hooks, use `@frontmcp/ui`.

**Key Principles:**

- Zero React dependency
- Platform-aware theming and CDN configuration
- Build tools for Tool UI generation
- esbuild/SWC bundling utilities
- Zod schema validation

## Architecture

```text
libs/uipack/src/
├── adapters/           # Platform adapters (OpenAI, Claude, etc.)
├── base-template/      # Default HTML wrappers with polyfills
├── bridge-runtime/     # MCP bridge runtime generation
├── build/              # Build-time API (buildToolUI, etc.)
├── bundler/            # esbuild/SWC bundling, caching, sandbox
├── dependency/         # CDN resolution and import maps
├── handlebars/         # Handlebars template engine
├── preview/            # Preview server utilities
├── registry/           # Tool UI registry
├── renderers/          # HTML/MDX client renderers
├── runtime/            # Runtime utilities (wrapper, sanitizer, CSP)
├── styles/             # Style variant definitions
├── theme/              # Theme system and CDN config
├── tool-template/      # Tool template utilities
├── types/              # TypeScript type definitions
├── typings/            # .d.ts type fetching
├── utils/              # Utilities (escapeHtml, safeStringify)
├── validation/         # Zod validation utilities
└── index.ts            # Main barrel exports
```

## Package Split

| Package            | Purpose                                                 | React Required |
| ------------------ | ------------------------------------------------------- | -------------- |
| `@frontmcp/uipack` | Bundling, build tools, platform adapters, theme         | No             |
| `@frontmcp/ui`     | React components, hooks, SSR rendering, HTML components | Yes            |

## Entry Points

| Path                             | Purpose                               |
| -------------------------------- | ------------------------------------- |
| `@frontmcp/uipack`               | Main exports                          |
| `@frontmcp/uipack/adapters`      | Platform adapters and meta builders   |
| `@frontmcp/uipack/base-template` | Default HTML templates with polyfills |
| `@frontmcp/uipack/build`         | Build-time API (buildToolUI)          |
| `@frontmcp/uipack/bundler`       | esbuild/SWC bundling, cache, sandbox  |
| `@frontmcp/uipack/dependency`    | CDN resolution and import maps        |
| `@frontmcp/uipack/handlebars`    | Handlebars integration                |
| `@frontmcp/uipack/preview`       | Preview server utilities              |
| `@frontmcp/uipack/registry`      | Tool UI registry                      |
| `@frontmcp/uipack/renderers`     | HTML/MDX client renderers             |
| `@frontmcp/uipack/runtime`       | Runtime utilities (wrapper, CSP)      |
| `@frontmcp/uipack/styles`        | Style variants                        |
| `@frontmcp/uipack/theme`         | Theme system and platform config      |
| `@frontmcp/uipack/types`         | Type definitions                      |
| `@frontmcp/uipack/typings`       | TypeScript definition fetching        |
| `@frontmcp/uipack/utils`         | Utilities                             |
| `@frontmcp/uipack/validation`    | Zod validation                        |

## Build API

```typescript
import { buildToolUI, getOutputModeForClient } from '@frontmcp/uipack/build';

// Build tool UI HTML
const html = await buildToolUI({
  template: '<div>{{output.data}}</div>',
  context: { input: {}, output: { data: 'Hello' } },
  platform: 'openai',
});

// Get output mode for client
const mode = getOutputModeForClient('openai');
```

## Theme System

### Default Theme (GitHub/OpenAI)

```typescript
import { DEFAULT_THEME, createTheme } from '@frontmcp/uipack/theme';

// Colors
DEFAULT_THEME.colors.semantic.primary; // '#24292f' (near-black)
DEFAULT_THEME.colors.semantic.secondary; // '#57606a' (medium gray)
DEFAULT_THEME.colors.semantic.accent; // '#0969da' (blue accent)
```

### Custom Themes

```typescript
const customTheme = createTheme({
  name: 'my-theme',
  colors: {
    semantic: { primary: '#0969da' },
  },
  cdn: {
    fonts: {
      preconnect: ['https://fonts.googleapis.com'],
      stylesheets: ['https://fonts.googleapis.com/css2?family=Roboto&display=swap'],
    },
  },
});
```

## Platform Support

### Available Platforms

```typescript
import { getPlatform, OPENAI_PLATFORM, CLAUDE_PLATFORM } from '@frontmcp/uipack/theme';

OPENAI_PLATFORM.network; // 'open' - can fetch external resources
CLAUDE_PLATFORM.network; // 'blocked' - needs inline scripts
```

### Building Platform-Aware HTML

```typescript
import { buildCdnScriptsFromTheme, DEFAULT_THEME } from '@frontmcp/uipack/theme';

// For platforms with network access
const scripts = buildCdnScriptsFromTheme(DEFAULT_THEME, { inline: false });

// For blocked-network platforms (Claude)
const inlineScripts = buildCdnScriptsFromTheme(DEFAULT_THEME, { inline: true });
```

## Renderers

### HTML Renderer

```typescript
import { htmlRenderer, HtmlRenderer } from '@frontmcp/uipack/renderers';

// Render HTML template
const html = await htmlRenderer.render(template, context);
```

### MDX Client Renderer (CDN-based)

```typescript
import { mdxClientRenderer, MdxClientRenderer } from '@frontmcp/uipack/renderers';

// Render MDX using CDN-based React (no bundled React)
const html = await mdxClientRenderer.render(mdxContent, context);
```

> **Note:** For server-side MDX rendering with bundled React, use `@frontmcp/ui/renderers`.

## Bundler Utilities

```typescript
import { BundlerCache, hashContent, createCacheKey, validateSource, executeCode } from '@frontmcp/uipack/bundler';

// Create cache for bundled results
const cache = new BundlerCache({ maxSize: 100, ttl: 60000 });

// Hash content for cache keys
const hash = hashContent(sourceCode);

// Validate source code security
const violations = validateSource(code, policy);
```

## Validation

```typescript
import { validateOptions, createErrorBox } from '@frontmcp/uipack/validation';

const result = validateOptions(options, {
  schema: MySchema,
  componentName: 'MyComponent',
});

if (!result.success) {
  return result.error; // HTML error box
}
```

## Testing Requirements

- **Coverage**: 95%+ across statements, branches, functions, lines
- **Validation Tests**: Every component must test invalid inputs
- **XSS Tests**: Test HTML escaping for user-provided content
- **Platform Tests**: Test behavior across platform configurations

Note: No React dependency!

## Anti-Patterns to Avoid

- Using `any` type without justification
- Missing `.strict()` on Zod schemas
- Not validating component options
- Exposing internal error details
- Skipping XSS escaping
- Hard-coding CDN URLs (use theme.cdn)
- Adding React dependencies (use @frontmcp/ui for React)

## Related Packages

- **@frontmcp/ui** - React components, hooks, SSR rendering, HTML components
- **@frontmcp/sdk** - Core FrontMCP SDK
- **@frontmcp/testing** - E2E testing utilities
