# @frontmcp/ui - SDK Development Guidelines

## Overview

`@frontmcp/ui` is a platform-agnostic HTML component library for building authentication and authorization UIs across LLM platforms (OpenAI, Claude, Gemini, ngrok).

**Key Principles:**

- Pure HTML string generation (no React/Vue/JSX)
- Zod schema validation for all component inputs
- Platform-aware theming and CDN configuration
- HTMX support for dynamic interactions
- GitHub/OpenAI gray-black aesthetic as default

## Architecture

```text
libs/ui/src/
├── components/        # UI components (button, card, form, etc.)
│   ├── *.ts          # Component implementations
│   └── *.schema.ts   # Zod schemas for validation
├── theme/
│   ├── presets/      # Theme presets (github-openai default)
│   ├── theme.ts      # ThemeConfig types and utilities
│   ├── cdn.ts        # CDN configuration and builders
│   └── platforms.ts  # Platform capabilities (OpenAI, Claude, etc.)
├── layouts/          # Page layout system
├── pages/            # Pre-built page templates
├── widgets/          # OpenAI App SDK widgets
├── validation/       # Validation utilities and error box
└── index.ts          # Main barrel exports
```

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
  // Validate options - returns error box on failure
  const validation = validateOptions<ComponentOptions>(options, {
    schema: ComponentOptionsSchema,
    componentName: 'component',
  });

  if (!validation.success) {
    return validation.error; // Returns styled error box HTML
  }

  const { variant = 'primary', size = 'md' } = validation.data;

  // Build HTML...
  return `<div class="...">${escapeHtml(content)}</div>`;
}
```

### 3. Add JSDoc Examples

````typescript
/**
 * @file component.ts
 * @description Component description.
 *
 * @example Basic usage
 * ```typescript
 * import { component } from '@frontmcp/ui';
 * const html = component('Content');
 * ```
 *
 * @example With options
 * ```typescript
 * const html = component('Content', {
 *   variant: 'secondary',
 *   htmx: { get: '/api/data', target: '#result' },
 * });
 * ```
 */
````

### 4. Write Validation Tests

```typescript
describe('Validation', () => {
  it('should return error box for invalid variant', () => {
    const html = component('Test', { variant: 'invalid' as any });
    expect(html).toContain('validation-error');
    expect(html).toContain('data-component="component"');
    expect(html).toContain('data-param="variant"');
  });

  it('should return error box for unknown properties', () => {
    const html = component('Test', { unknownProp: true } as any);
    expect(html).toContain('validation-error');
  });

  it('should accept valid options', () => {
    const html = component('Test', { variant: 'primary' });
    expect(html).not.toContain('validation-error');
  });
});
```

## Theme System

### Default Theme (GitHub/OpenAI)

The default theme uses a gray-black monochromatic palette:

```typescript
import { DEFAULT_THEME, GITHUB_OPENAI_THEME } from '@frontmcp/ui';

// Colors
DEFAULT_THEME.colors.semantic.primary; // '#24292f' (near-black)
DEFAULT_THEME.colors.semantic.secondary; // '#57606a' (medium gray)
DEFAULT_THEME.colors.semantic.accent; // '#0969da' (blue accent)
```

### Creating Custom Themes

```typescript
import { createTheme } from '@frontmcp/ui';

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
    scripts: {
      tailwind: 'https://my-cdn.example.com/tailwind.js',
    },
  },
});
```

### CDN Configuration

Themes can customize all external resource URLs:

```typescript
theme.cdn = {
  fonts: {
    preconnect: string[];    // Font provider preconnect URLs
    stylesheets: string[];   // Font stylesheet URLs
  },
  icons: {
    script: { url: string; integrity?: string };
  },
  scripts: {
    tailwind: string;        // Tailwind Browser CDN
    htmx: { url: string; integrity?: string };
    alpine: { url: string; integrity?: string };
  },
};
```

## Platform Support

### Available Platforms

```typescript
import { getPlatform, OPENAI_PLATFORM, CLAUDE_PLATFORM } from '@frontmcp/ui';

// Platform capabilities
OPENAI_PLATFORM.network; // 'open' - can fetch external resources
CLAUDE_PLATFORM.network; // 'blocked' - needs inline scripts
OPENAI_PLATFORM.scripts; // 'external' - use CDN script tags
CLAUDE_PLATFORM.scripts; // 'inline' - embed scripts in HTML
```

### Building Platform-Aware HTML

```typescript
import { buildCdnScriptsFromTheme, DEFAULT_THEME } from '@frontmcp/ui';

// For platforms with network access
const scripts = buildCdnScriptsFromTheme(DEFAULT_THEME, {
  tailwind: true,
  htmx: true,
  inline: false,
});

// For blocked-network platforms (Claude Artifacts)
await fetchAndCacheScriptsFromTheme(DEFAULT_THEME);
const inlineScripts = buildCdnScriptsFromTheme(DEFAULT_THEME, {
  inline: true,
});
```

## Validation Error Handling

Invalid component options render a styled error box:

```html
<div class="validation-error ..." data-component="button" data-param="variant">
  Invalid property "variant" in button component
</div>
```

The error box:

- Is styled with red background/border
- Shows component name and invalid parameter
- Does NOT expose internal error details (security)
- Prevents XSS via HTML escaping

## File Naming Conventions

```text
component.ts         # Component implementation
component.schema.ts  # Zod schema definitions
component.test.ts    # Jest tests (include validation tests)
```

## Testing Requirements

- **Coverage**: 95%+ across statements, branches, functions, lines
- **Validation Tests**: Every component must test invalid inputs
- **XSS Tests**: Test HTML escaping for user-provided content
- **Platform Tests**: Test behavior across platform configurations

## Common Patterns

### HTMX Integration

```typescript
export const HtmxSchema = z
  .object({
    get: z.string().optional(),
    post: z.string().optional(),
    put: z.string().optional(),
    delete: z.string().optional(),
    target: z.string().optional(),
    swap: z.string().optional(),
    trigger: z.string().optional(),
  })
  .strict()
  .optional();
```

### Escaping User Content

Always use `escapeHtml()` for user-provided content:

```typescript
import { escapeHtml } from '../layouts/base';

const html = `<div title="${escapeHtml(title)}">${escapeHtml(content)}</div>`;
```

### Size/Variant Enums

Use consistent naming:

```typescript
// Sizes
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// Variants
type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
```

## Anti-Patterns to Avoid

- Using `any` type without justification
- Missing `.strict()` on Zod schemas
- Not validating component options
- Exposing internal error details
- Skipping XSS escaping
- Hard-coding CDN URLs (use theme.cdn)
- Missing JSDoc examples
- Tests without validation coverage
