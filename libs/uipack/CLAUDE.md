# @frontmcp/uipack - Development Guidelines

## Overview

`@frontmcp/uipack` provides **HTML shell builder, pluggable import resolver, and NPM component loader** for MCP UI development - all without requiring React.

This is the React-free core package. For React components and hooks, use `@frontmcp/ui`.

**Key Principles:**

- Zero React dependency
- HTML shell generation with CSP, data injection, bridge runtime
- Pluggable import resolution (esm.sh default, custom resolvers)
- NPM component loading (npm, file, URL, or inline function)
- TypeScript type fetching from esm.sh

## Architecture

```text
libs/uipack/src/
├── bridge-runtime/   # Platform-aware IIFE generator
├── component/        # NPM component loader (4 source modes)
├── resolver/         # Pluggable import resolution (esm.sh default)
├── shell/            # HTML shell builder with CSP, data injection, bridge
├── types/            # Standalone UI config types
├── typings/          # TypeScript type fetching engine
├── utils/            # XSS-safe escaping functions
└── index.ts          # Main barrel exports
```

## Package Split

| Package            | Purpose                                                   | React Required |
| ------------------ | --------------------------------------------------------- | -------------- |
| `@frontmcp/uipack` | HTML shell builder, import resolver, NPM component loader | No             |
| `@frontmcp/ui`     | React components, hooks, SSR rendering                    | Yes            |

## Entry Points

| Path                              | Purpose                          |
| --------------------------------- | -------------------------------- |
| `@frontmcp/uipack`                | Main exports                     |
| `@frontmcp/uipack/types`          | Standalone UI config types       |
| `@frontmcp/uipack/utils`          | XSS-safe escaping functions      |
| `@frontmcp/uipack/bridge-runtime` | Platform bridge IIFE generator   |
| `@frontmcp/uipack/typings`        | TypeScript .d.ts fetching engine |
| `@frontmcp/uipack/resolver`       | Pluggable import resolution      |
| `@frontmcp/uipack/shell`          | HTML shell builder               |
| `@frontmcp/uipack/component`      | Polymorphic component loader     |

## Shell Builder

```typescript
import { buildShell, buildCSPMetaTag } from '@frontmcp/uipack/shell';

// Build an HTML shell with CSP, data injection, and bridge
const result = buildShell({
  body: '<div id="app"></div>',
  scripts: ['https://esm.sh/react'],
  csp: { scriptSrc: ["'self'"], styleSrc: ["'unsafe-inline'"] },
  data: { output: { temperature: 18 } },
});
```

## Import Resolver

```typescript
import { resolveImports, createEsmShResolver } from '@frontmcp/uipack/resolver';

// Resolve NPM imports to CDN URLs
const resolver = createEsmShResolver();
const resolved = await resolver.resolve('react', '18.3.0');
```

## Component Loader

```typescript
import { loadComponent } from '@frontmcp/uipack/component';

// Load component from npm
const component = await loadComponent({ source: 'npm', package: '@my-org/widget' });

// Load from URL
const component = await loadComponent({ source: 'url', href: 'https://cdn.example.com/widget.js' });
```

## Custom Shell Templates

```typescript
import { resolveShellTemplate, applyShellTemplate } from '@frontmcp/uipack/shell';

// Resolve a custom shell from npm, URL, or inline source
const template = await resolveShellTemplate({ source: 'npm', package: '@my-org/shell' });
const html = applyShellTemplate(template, { body: '<div>Content</div>' });
```

## Testing Requirements

- **Coverage**: 95%+ across statements, branches, functions, lines
- **XSS Tests**: Test HTML escaping for user-provided content
- **CSP Tests**: Test Content Security Policy generation

Note: No React dependency!

## Anti-Patterns to Avoid

- Using `any` type without justification
- Skipping XSS escaping
- Hard-coding CDN URLs (use resolver)
- Adding React dependencies (use @frontmcp/ui for React)
- Importing from deleted modules (renderers, bundler, build, theme, validation, etc.)

## Related Packages

- **@frontmcp/ui** - React components, hooks, SSR rendering
- **@frontmcp/sdk** - Core FrontMCP SDK
- **@frontmcp/testing** - E2E testing utilities
