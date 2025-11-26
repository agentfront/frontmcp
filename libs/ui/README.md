# @frontmcp/ui

Platform-agnostic HTML component library for building authentication and authorization UIs across LLM platforms.

## Features

- **Pure HTML Output** - No React, Vue, or JSX dependencies. Components return HTML strings.
- **Zod Validation** - All component options validated at runtime with detailed error feedback.
- **Platform-Aware** - Optimized for OpenAI, Claude, Gemini, and ngrok platforms.
- **HTMX Support** - Built-in support for dynamic interactions without JavaScript.
- **Theme System** - Customizable themes with CDN URL configuration.
- **GitHub/OpenAI Theme** - Default gray-black aesthetic inspired by GitHub and OpenAI.

## Installation

```bash
npm install @frontmcp/ui
# or
yarn add @frontmcp/ui
```

## Quick Start

```typescript
import { button, card, baseLayout, DEFAULT_THEME } from '@frontmcp/ui';

// Create a simple button
const btn = button('Click Me', { variant: 'primary', size: 'md' });

// Create a card with content
const content = card(
  `
  <h2>Welcome</h2>
  <p>Hello, world!</p>
`,
  { variant: 'default' },
);

// Wrap in a page layout
const page = baseLayout(content, {
  title: 'My Page',
  theme: DEFAULT_THEME,
});
```

## Components

### Button

```typescript
import { button, primaryButton, dangerButton, buttonGroup } from '@frontmcp/ui';

// Basic button
button('Submit');

// Button variants
button('Save', { variant: 'secondary' });
button('Delete', { variant: 'danger' });
button('Cancel', { variant: 'outline' });

// Shorthand functions
primaryButton('Submit');
dangerButton('Delete');

// Button with HTMX
button('Load More', {
  htmx: {
    get: '/api/items?page=2',
    target: '#items-list',
    swap: 'beforeend',
  },
});

// Button group
buttonGroup([button('Edit', { variant: 'outline' }), button('Delete', { variant: 'danger' })], { attached: true });
```

### Card

```typescript
import { card, cardGroup } from '@frontmcp/ui';

// Basic card
card('<p>Card content</p>');

// Card with title and footer
card('<p>Content</p>', {
  title: 'Card Title',
  subtitle: 'Optional subtitle',
  footer: '<button>Action</button>',
  variant: 'elevated',
});

// Card group
cardGroup([card('Card 1', { title: 'First' }), card('Card 2', { title: 'Second' })], { columns: 2 });
```

### Form Components

```typescript
import { form, input, select, textarea, checkbox, radioGroup, formRow, formActions } from '@frontmcp/ui';

// Complete form
form(
  `
  ${input({ name: 'email', type: 'email', label: 'Email Address', required: true })}
  ${input({ name: 'password', type: 'password', label: 'Password', required: true })}
  ${checkbox({ name: 'remember', label: 'Remember me' })}
  ${formActions(button('Sign In', { type: 'submit' }))}
`,
  {
    action: '/login',
    method: 'post',
    htmx: { post: '/api/login', target: '#result' },
  },
);

// Select dropdown
select({
  name: 'country',
  label: 'Country',
  options: [
    { value: 'us', label: 'United States' },
    { value: 'uk', label: 'United Kingdom' },
  ],
});

// Radio group
radioGroup({
  name: 'plan',
  label: 'Select Plan',
  options: [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
  ],
});
```

### Alert & Badge

```typescript
import { alert, successAlert, warningAlert, badge, activeBadge } from '@frontmcp/ui';

// Alerts
alert('Information message', { variant: 'info' });
successAlert('Operation completed!');
warningAlert('Please review your input.');

// Badges
badge('New');
badge('Active', { variant: 'success' });
activeBadge(); // Green "Active" badge
```

### Modal & Drawer

```typescript
import { modal, modalTrigger, drawer, confirmModal } from '@frontmcp/ui';

// Basic modal
modal('<p>Modal content</p>', {
  id: 'my-modal',
  title: 'Modal Title',
  size: 'md',
});

// Modal trigger button
modalTrigger({ targetId: 'my-modal', text: 'Open Modal' });

// Confirmation modal
confirmModal({
  id: 'delete-confirm',
  title: 'Confirm Delete',
  message: 'Are you sure you want to delete this item?',
  variant: 'danger',
  onConfirm: { delete: '/api/items/123' },
});

// Drawer
drawer('<nav>Navigation</nav>', {
  id: 'nav-drawer',
  position: 'left',
  title: 'Menu',
});
```

### Table & Pagination

```typescript
import { table, pagination } from '@frontmcp/ui';

// Data table
const data = [
  { id: 1, name: 'John', email: 'john@example.com' },
  { id: 2, name: 'Jane', email: 'jane@example.com' },
];

table(data, {
  columns: [
    { key: 'id', header: 'ID', width: '60px' },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'email', header: 'Email' },
  ],
  selectable: true,
  hoverable: true,
});

// Pagination
pagination({
  page: 1,
  totalPages: 10,
  htmx: { get: '/api/items?page={page}', target: '#table' },
});
```

## Theme System

### Using the Default Theme

```typescript
import { DEFAULT_THEME, GITHUB_OPENAI_THEME, baseLayout } from '@frontmcp/ui';

// DEFAULT_THEME is the GitHub/OpenAI gray-black theme
const page = baseLayout(content, {
  theme: DEFAULT_THEME,
});
```

### Creating Custom Themes

```typescript
import { createTheme } from '@frontmcp/ui';

const myTheme = createTheme({
  name: 'my-brand',
  colors: {
    semantic: {
      primary: '#0969da',
      secondary: '#8250df',
      accent: '#bf8700',
    },
  },
  typography: {
    families: {
      sans: '"Roboto", system-ui, sans-serif',
    },
  },
  cdn: {
    fonts: {
      stylesheets: ['https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap'],
    },
  },
});
```

### Theme CDN Configuration

Customize external resource URLs for compliance or self-hosting:

```typescript
const theme = createTheme({
  cdn: {
    fonts: {
      preconnect: ['https://fonts.example.com'],
      stylesheets: ['https://fonts.example.com/css/roboto.css'],
    },
    scripts: {
      tailwind: 'https://cdn.example.com/tailwind.js',
      htmx: {
        url: 'https://cdn.example.com/htmx.min.js',
        integrity: 'sha512-...',
      },
    },
    icons: {
      script: { url: 'https://cdn.example.com/lucide.min.js' },
    },
  },
});
```

## Platform Support

### Platform Detection

```typescript
import { getPlatform, canUseCdn, needsInlineScripts } from '@frontmcp/ui';

const platform = getPlatform('openai');

if (canUseCdn(platform)) {
  // Use external CDN scripts
} else if (needsInlineScripts(platform)) {
  // Embed scripts inline for blocked-network platforms
}
```

### Building for Specific Platforms

```typescript
import { buildCdnScriptsFromTheme, fetchAndCacheScriptsFromTheme, DEFAULT_THEME } from '@frontmcp/ui';

// For OpenAI, Gemini, ngrok (open network)
const scripts = buildCdnScriptsFromTheme(DEFAULT_THEME);

// For Claude Artifacts (blocked network)
await fetchAndCacheScriptsFromTheme(DEFAULT_THEME);
const inlineScripts = buildCdnScriptsFromTheme(DEFAULT_THEME, { inline: true });
```

## Validation

All components validate their options using Zod schemas. Invalid inputs render an error box instead of crashing:

```typescript
// Valid - renders button
button('Click', { variant: 'primary' });

// Invalid - renders error box showing "button" component and "variant" param
button('Click', { variant: 'invalid' as any });

// Unknown properties rejected (strict mode)
button('Click', { unknownProp: true } as any);
```

### Using Schemas Directly

```typescript
import { ButtonOptionsSchema } from '@frontmcp/ui';

// Validate before passing to component
const result = ButtonOptionsSchema.safeParse(userInput);
if (result.success) {
  button('Click', result.data);
} else {
  console.error('Validation errors:', result.error.issues);
}
```

## Layouts

### Base Layout

```typescript
import { baseLayout } from '@frontmcp/ui';

const html = baseLayout(content, {
  title: 'Page Title',
  description: 'Page description for SEO',
  theme: DEFAULT_THEME,
  width: 'md', // 'sm' | 'md' | 'lg' | 'xl' | 'full'
  align: 'center', // 'left' | 'center' | 'right'
  scripts: { htmx: true, tailwind: true },
});
```

## Development

### Building

```bash
yarn nx build ui
```

### Testing

```bash
yarn nx test ui
```

### Test Coverage

The library maintains 95%+ test coverage across all metrics.

## License

MIT
