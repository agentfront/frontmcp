# @frontmcp/uipack - Development Guidelines

## Overview

`@frontmcp/uipack` provides **bundling, build tools, HTML components, and platform adapters** for MCP UI development - all without requiring React.

This is the React-free core package. For React components and hooks, use `@frontmcp/ui`.

**Key Principles:**

- Zero React dependency
- Pure HTML string generation
- Zod schema validation for all component inputs
- Platform-aware theming and CDN configuration
- HTMX support for dynamic interactions

## Architecture

```text
libs/uipack/src/
├── adapters/           # Platform adapters (OpenAI, Claude, etc.)
├── base-template/      # Default HTML wrappers with polyfills
├── bridge/             # Multi-platform MCP bridge
├── build/              # Build-time API (buildToolUI, etc.)
├── bundler/            # esbuild/SWC bundling
├── components/         # HTML string components (button, card, etc.)
├── dependency/         # CDN resolution and import maps
├── handlebars/         # Handlebars template engine
├── layouts/            # Page layout templates
├── pages/              # Pre-built pages (consent, error)
├── registry/           # Tool UI registry
├── renderers/          # HTML/MDX renderers
├── runtime/            # Runtime utilities (template helpers)
├── styles/             # Style variant definitions
├── theme/              # Theme system and CDN config
├── tool-template/      # Tool template utilities
├── types/              # TypeScript type definitions
├── typings/            # .d.ts type fetching
├── utils/              # Utilities (escapeHtml, safeStringify)
├── validation/         # Zod validation utilities
├── web-components/     # Custom HTML elements
├── widgets/            # OpenAI widget utilities
└── index.ts            # Main barrel exports
```

## Package Split

| Package            | Purpose                                                   | React Required |
| ------------------ | --------------------------------------------------------- | -------------- |
| `@frontmcp/uipack` | Bundling, build tools, HTML components, platform adapters | No             |
| `@frontmcp/ui`     | React components, hooks, SSR rendering                    | Yes            |

## Entry Points

| Path                              | Purpose                               |
| --------------------------------- | ------------------------------------- |
| `@frontmcp/uipack`                | Main exports                          |
| `@frontmcp/uipack/adapters`       | Platform adapters and meta builders   |
| `@frontmcp/uipack/base-template`  | Default HTML templates with polyfills |
| `@frontmcp/uipack/bridge`         | MCP bridge for multiple platforms     |
| `@frontmcp/uipack/build`          | Build-time API                        |
| `@frontmcp/uipack/bundler`        | esbuild/SWC bundling                  |
| `@frontmcp/uipack/components`     | HTML string components                |
| `@frontmcp/uipack/dependency`     | CDN resolution                        |
| `@frontmcp/uipack/handlebars`     | Handlebars integration                |
| `@frontmcp/uipack/layouts`        | Page layouts                          |
| `@frontmcp/uipack/pages`          | Pre-built pages                       |
| `@frontmcp/uipack/registry`       | Tool UI registry                      |
| `@frontmcp/uipack/renderers`      | HTML/MDX renderers                    |
| `@frontmcp/uipack/runtime`        | Runtime utilities                     |
| `@frontmcp/uipack/styles`         | Style variants                        |
| `@frontmcp/uipack/theme`          | Theme system                          |
| `@frontmcp/uipack/types`          | Type definitions                      |
| `@frontmcp/uipack/utils`          | Utilities                             |
| `@frontmcp/uipack/validation`     | Zod validation                        |
| `@frontmcp/uipack/web-components` | Custom elements                       |
| `@frontmcp/uipack/widgets`        | OpenAI widgets                        |

## Component Development

### 1. Create Schema First

Every component must have a Zod schema with `.strict()` mode:

```typescript
// component.schema.ts
import { z } from 'zod';

export const ComponentOptionsSchema = z
  .object({
    variant: z.enum(['primary', 'secondary']).optional(),
    size: z.enum(['sm', 'md', 'lg']).optional(),
    disabled: z.boolean().optional(),
    className: z.string().optional(),
    htmx: z
      .object({
        get: z.string().optional(),
        post: z.string().optional(),
        target: z.string().optional(),
        swap: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict(); // IMPORTANT: Reject unknown properties

export type ComponentOptions = z.infer<typeof ComponentOptionsSchema>;
```

### 2. Validate Inputs in Component

```typescript
// component.ts
import { validateOptions } from '../validation';
import { ComponentOptionsSchema, type ComponentOptions } from './component.schema';

export function component(content: string, options: ComponentOptions = {}): string {
  const validation = validateOptions<ComponentOptions>(options, {
    schema: ComponentOptionsSchema,
    componentName: 'component',
  });

  if (!validation.success) {
    return validation.error; // Returns styled error box HTML
  }

  const { variant = 'primary', size = 'md' } = validation.data;
  return `<div class="...">${escapeHtml(content)}</div>`;
}
```

### 3. Always Escape User Content

```typescript
import { escapeHtml } from '../utils';

const html = `<div title="${escapeHtml(title)}">${escapeHtml(content)}</div>`;
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

## Testing Requirements

- **Coverage**: 95%+ across statements, branches, functions, lines
- **Validation Tests**: Every component must test invalid inputs
- **XSS Tests**: Test HTML escaping for user-provided content
- **Platform Tests**: Test behavior across platform configurations

## Dependencies

```json
{
  "dependencies": {
    "@swc/core": "^1.5.0",
    "enclave-vm": "^1.0.3",
    "esbuild": "^0.27.1",
    "handlebars": "^4.7.8",
    "zod": "^4.0.0"
  }
}
```

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

- **@frontmcp/ui** - React components, hooks, SSR rendering
- **@frontmcp/sdk** - Core FrontMCP SDK
- **@frontmcp/testing** - E2E testing utilities
