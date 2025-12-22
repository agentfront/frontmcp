# @frontmcp/uipack

React-free bundling, build tools, HTML components, and platform adapters for MCP UI development.

## Package Split

This package is part of a two-package system:

| Package              | Purpose                                                   | React Required |
| -------------------- | --------------------------------------------------------- | -------------- |
| **@frontmcp/uipack** | Bundling, build tools, HTML components, platform adapters | No             |
| **@frontmcp/ui**     | React components, hooks, SSR rendering                    | Yes            |

Use this package when you don't need React. For React components and hooks, use `@frontmcp/ui`.

## Installation

```bash
npm install @frontmcp/uipack
# or
yarn add @frontmcp/uipack
```

## Features

- **Zero React Dependency** - No React required
- **HTML Components** - Button, Card, Alert, Badge as HTML strings
- **Build Tools** - `buildToolUI`, platform adapters
- **Bundler** - esbuild/SWC bundling
- **Theme System** - Customizable themes with CDN configuration
- **Platform Support** - OpenAI, Claude, Gemini, ngrok
- **Zod Validation** - Runtime validation for all components

## Quick Start

### HTML Components

```typescript
import { button, card, alert, badge } from '@frontmcp/ui/components';

// Create HTML string components
const btn = button('Click Me', { variant: 'primary', size: 'md' });
const cardHtml = card('<h2>Welcome</h2><p>Hello!</p>', { title: 'Card Title' });
const alertHtml = alert('Success!', { variant: 'success' });
const badgeHtml = badge('Active', { variant: 'success' });
```

### Build API

```typescript
import { buildToolUI, getOutputModeForClient } from '@frontmcp/uipack/build';

// Build tool UI HTML
const html = await buildToolUI({
  template: '<div>Result: {{output.data}}</div>',
  context: { input: {}, output: { data: 'Hello, World!' } },
  platform: 'openai',
});

// Get output mode for client type
const mode = getOutputModeForClient('openai');
```

### Platform Adapters

```typescript
import { buildToolDiscoveryMeta, buildUIMeta } from '@frontmcp/uipack/adapters';
import type { AIPlatformType } from '@frontmcp/uipack/adapters';

// Build discovery metadata for tool listing
const meta = buildToolDiscoveryMeta({
  toolName: 'my-tool',
  uiType: 'html',
  platform: 'openai',
});

// Build UI metadata for tool response
const uiMeta = buildUIMeta({
  html: '<div>Result</div>',
  platform: 'openai',
});
```

### Theme System

```typescript
import { DEFAULT_THEME, createTheme } from '@frontmcp/uipack/theme';

// Use default GitHub/OpenAI theme
console.log(DEFAULT_THEME.colors.semantic.primary); // '#24292f'

// Create custom theme
const myTheme = createTheme({
  name: 'my-brand',
  colors: {
    semantic: {
      primary: '#0969da',
      secondary: '#8250df',
    },
  },
  cdn: {
    fonts: {
      stylesheets: ['https://fonts.googleapis.com/css2?family=Roboto&display=swap'],
    },
  },
});
```

### Page Layouts

```typescript
import { basePage, escapeHtml } from '@frontmcp/uipack/layouts';
import { DEFAULT_THEME } from '@frontmcp/uipack/theme';

const html = basePage({
  title: 'My Page',
  content: '<h1>Hello, World!</h1>',
  theme: DEFAULT_THEME,
});
```

## Entry Points

| Path                             | Purpose                |
| -------------------------------- | ---------------------- |
| `@frontmcp/uipack`               | Main exports           |
| `@frontmcp/uipack/adapters`      | Platform adapters      |
| `@frontmcp/uipack/base-template` | Default HTML templates |
| `@frontmcp/uipack/bridge`        | MCP bridge             |
| `@frontmcp/uipack/build`         | Build API              |
| `@frontmcp/uipack/bundler`       | esbuild/SWC bundler    |
| `@frontmcp/uipack/components`    | HTML components        |
| `@frontmcp/uipack/handlebars`    | Handlebars integration |
| `@frontmcp/uipack/layouts`       | Page layouts           |
| `@frontmcp/uipack/pages`         | Pre-built pages        |
| `@frontmcp/uipack/registry`      | Tool UI registry       |
| `@frontmcp/uipack/renderers`     | HTML/MDX renderers     |
| `@frontmcp/uipack/runtime`       | Runtime utilities      |
| `@frontmcp/uipack/styles`        | Style variants         |
| `@frontmcp/uipack/theme`         | Theme system           |
| `@frontmcp/uipack/types`         | Type definitions       |
| `@frontmcp/uipack/utils`         | Utilities              |
| `@frontmcp/uipack/validation`    | Zod validation         |
| `@frontmcp/uipack/widgets`       | OpenAI widgets         |

## Components

All components return HTML strings and validate their options:

### Button

```typescript
import { button, primaryButton, dangerButton, buttonGroup } from '@frontmcp/uipack/components';

button('Submit', { variant: 'primary' });
button('Delete', { variant: 'danger' });
buttonGroup([button('Edit'), button('Delete')], { attached: true });

// With HTMX
button('Load More', {
  htmx: { get: '/api/items', target: '#list', swap: 'beforeend' },
});
```

### Card

```typescript
import { card, cardGroup } from '@frontmcp/uipack/components';

card('<p>Content</p>', { title: 'Card Title', footer: '<button>Action</button>' });
cardGroup([card('One'), card('Two')], { columns: 2 });
```

### Form Components

```typescript
import { form, input, select, textarea, checkbox } from '@frontmcp/uipack/components';

form(
  `
  ${input({ name: 'email', type: 'email', label: 'Email', required: true })}
  ${input({ name: 'password', type: 'password', label: 'Password' })}
  ${checkbox({ name: 'remember', label: 'Remember me' })}
  ${button('Sign In', { type: 'submit' })}
`,
  { action: '/login', method: 'post' },
);
```

### Alert & Badge

```typescript
import { alert, successAlert, badge, activeBadge } from '@frontmcp/uipack/components';

alert('Info message', { variant: 'info' });
successAlert('Done!');
badge('New', { variant: 'primary' });
activeBadge(); // Green "Active" badge
```

## Validation

Components validate their options and render an error box for invalid inputs:

```typescript
// Valid - renders button
button('Click', { variant: 'primary' });

// Invalid - renders error box
button('Click', { variant: 'invalid' as any });

// Unknown properties rejected
button('Click', { unknownProp: true } as any);
```

## Platform Support

```typescript
import { getPlatform, OPENAI_PLATFORM, CLAUDE_PLATFORM } from '@frontmcp/uipack/theme';

// OpenAI - open network, external scripts
OPENAI_PLATFORM.network; // 'open'
OPENAI_PLATFORM.scripts; // 'external'

// Claude - blocked network, inline scripts
CLAUDE_PLATFORM.network; // 'blocked'
CLAUDE_PLATFORM.scripts; // 'inline'
```

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

No React dependency!

## Development

### Building

```bash
yarn nx build uipack
```

### Testing

```bash
yarn nx test uipack
```

## Related Packages

- **[@frontmcp/ui](../ui/README.md)** - React components, hooks, SSR rendering
- **[@frontmcp/sdk](../sdk/README.md)** - Core FrontMCP SDK
- **[@frontmcp/testing](../testing/README.md)** - E2E testing utilities

## License

Apache-2.0
