# UI Resources

UI Resources enable MCP tools to return renderable HTML content that can be displayed in the browser. This pattern connects tool outputs to visual representations.

## Overview

UI Resources solve the problem of how AI agents can present rich UI to users through MCP. Instead of returning plain text or JSON, tools can return HTML that gets rendered in sandboxed iframes.

### Key Concepts

1. **UI Resource** - An HTML document returned as an MCP resource
2. **`createUIResource()`** - Helper to create properly formatted UI resources
3. **`_meta.resourceUri`** - Links tool results to their UI representation
4. **`UIResourceRenderer`** - React component for rendering UI resources safely

## Quick Start

### Creating a UI Resource

```typescript
import { createUIResource } from '@frontmcp/browser';
import { z } from 'zod';

// Define a tool that returns a UI resource
server.registerTool('render-chart', {
  description: 'Render data as a chart',
  inputSchema: z.object({
    data: z.array(
      z.object({
        label: z.string(),
        value: z.number(),
      }),
    ),
    type: z.enum(['bar', 'line', 'pie']).default('bar'),
  }),
  execute: async (args) => {
    // Create the UI resource
    const uiResource = createUIResource({
      html: generateChartHtml(args.data, args.type),
      title: 'Data Chart',
      width: 600,
      height: 400,
    });

    return {
      success: true,
      message: `Created ${args.type} chart with ${args.data.length} data points`,
      _meta: {
        resourceUri: uiResource.uri,
      },
    };
  },
});
```

### Rendering the UI Resource

```tsx
import { UIResourceRenderer, useUIResource } from '@frontmcp/browser/react';

function ToolResultDisplay({ toolResult }) {
  const resourceUri = toolResult._meta?.resourceUri;
  const { resource, isLoading, error } = useUIResource(resourceUri);

  if (!resourceUri) {
    return <div>{JSON.stringify(toolResult)}</div>;
  }

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <UIResourceRenderer resource={resource} sandbox={['allow-scripts']} width={600} height={400} />;
}
```

## API Reference

### `createUIResource(options)`

Creates a UI resource with properly formatted HTML content.

```typescript
interface CreateUIResourceOptions {
  /**
   * The HTML content to render
   */
  html: string;

  /**
   * Resource title/name
   */
  title?: string;

  /**
   * Suggested width for rendering
   */
  width?: number;

  /**
   * Suggested height for rendering
   */
  height?: number;

  /**
   * Custom URI for the resource
   * @default auto-generated
   */
  uri?: string;

  /**
   * Additional CSS to inject
   */
  css?: string;

  /**
   * Additional JavaScript to inject
   */
  scripts?: string[];

  /**
   * Meta tags to add to the document
   */
  meta?: Record<string, string>;

  /**
   * Whether to include default styles
   * @default true
   */
  includeDefaultStyles?: boolean;
}

interface UIResource {
  /**
   * Resource URI (used in _meta.resourceUri)
   */
  uri: string;

  /**
   * MIME type: 'text/html;profile=mcp-app'
   */
  mimeType: string;

  /**
   * Full HTML document content
   */
  content: string;

  /**
   * Suggested dimensions
   */
  dimensions?: {
    width: number;
    height: number;
  };
}

const resource = createUIResource(options);
```

### Resource Registration

```typescript
// Resources are auto-registered when created
const uiResource = createUIResource({ html: '<div>Hello</div>' });

// Or manually register
server.registerResource(uiResource.uri, {
  name: 'Dynamic UI',
  mimeType: uiResource.mimeType,
  read: async () => ({
    contents: [
      {
        uri: uiResource.uri,
        mimeType: uiResource.mimeType,
        text: uiResource.content,
      },
    ],
  }),
});
```

## MIME Type

UI Resources use a special MIME type to identify them:

```
text/html;profile=mcp-app
```

This allows clients to:

1. Identify resources that should be rendered as UI
2. Apply appropriate sandboxing
3. Handle them differently from regular HTML

```typescript
// Check if a resource is a UI resource
function isUIResource(resource: Resource): boolean {
  return resource.mimeType === 'text/html;profile=mcp-app';
}
```

## Tool-to-UI Linking with `_meta`

The `_meta.resourceUri` pattern links tool results to their UI representation:

```typescript
interface ToolResult {
  // Regular result fields
  success: boolean;
  data?: unknown;

  // Link to UI resource
  _meta?: {
    /**
     * URI of the UI resource to render
     */
    resourceUri?: string;

    /**
     * How to display the UI
     */
    uiHint?: 'inline' | 'modal' | 'panel' | 'fullscreen';

    /**
     * Whether to auto-render
     */
    autoRender?: boolean;
  };
}
```

### Example: Form Tool

```typescript
server.registerTool('create-form', {
  description: 'Create an interactive form',
  inputSchema: z.object({
    fields: z.array(
      z.object({
        name: z.string(),
        type: z.enum(['text', 'email', 'number', 'select', 'checkbox']),
        label: z.string(),
        required: z.boolean().default(false),
        options: z.array(z.string()).optional(),
      }),
    ),
    submitUrl: z.string().url(),
    title: z.string().optional(),
  }),
  execute: async (args) => {
    const formHtml = generateFormHtml(args.fields, args.submitUrl, args.title);

    const uiResource = createUIResource({
      html: formHtml,
      title: args.title || 'Form',
      width: 400,
      height: 'auto',
    });

    return {
      success: true,
      formId: uiResource.uri,
      fieldCount: args.fields.length,
      _meta: {
        resourceUri: uiResource.uri,
        uiHint: 'modal',
      },
    };
  },
});
```

### Example: Code Editor Tool

```typescript
server.registerTool('code-editor', {
  description: 'Open a code editor',
  inputSchema: z.object({
    code: z.string(),
    language: z.string().default('javascript'),
    theme: z.enum(['light', 'dark']).default('dark'),
    readOnly: z.boolean().default(false),
  }),
  execute: async (args) => {
    const editorHtml = generateCodeEditorHtml(args);

    const uiResource = createUIResource({
      html: editorHtml,
      title: `Code Editor (${args.language})`,
      width: 800,
      height: 600,
      scripts: ['https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js'],
    });

    return {
      success: true,
      editorId: uiResource.uri,
      _meta: {
        resourceUri: uiResource.uri,
        uiHint: 'panel',
      },
    };
  },
});
```

## React Components

### `UIResourceRenderer`

Renders a UI resource in a sandboxed iframe.

```tsx
interface UIResourceRendererProps {
  /**
   * The UI resource to render
   */
  resource: UIResource;

  /**
   * Sandbox permissions for the iframe
   * @default ['allow-scripts']
   */
  sandbox?: SandboxPermission[];

  /**
   * Width of the iframe
   */
  width?: number | string;

  /**
   * Height of the iframe
   */
  height?: number | string;

  /**
   * CSS class for the container
   */
  className?: string;

  /**
   * Inline styles for the container
   */
  style?: React.CSSProperties;

  /**
   * Called when the iframe loads
   */
  onLoad?: () => void;

  /**
   * Called on load error
   */
  onError?: (error: Error) => void;

  /**
   * Called when the iframe sends a message
   */
  onMessage?: (message: unknown) => void;

  /**
   * Whether to allow auto-resize based on content
   * @default false
   */
  autoResize?: boolean;
}

<UIResourceRenderer
  resource={resource}
  sandbox={['allow-scripts', 'allow-forms']}
  width={600}
  height={400}
  onLoad={() => console.log('Loaded')}
  onError={(e) => console.error(e)}
  onMessage={(msg) => handleMessage(msg)}
/>;
```

### `useUIResource`

Hook to fetch and manage a UI resource.

```tsx
function useUIResource(uri: string | undefined): {
  resource: UIResource | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

// Usage
function MyComponent({ resourceUri }) {
  const { resource, isLoading, error, refetch } = useUIResource(resourceUri);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;
  if (!resource) return null;

  return <UIResourceRenderer resource={resource} />;
}
```

### `ToolResultWithUI`

Automatically renders tool results with UI resources.

```tsx
interface ToolResultWithUIProps {
  /**
   * The tool result object
   */
  result: ToolResult;

  /**
   * Fallback renderer for non-UI results
   */
  fallback?: (result: ToolResult) => React.ReactNode;

  /**
   * Sandbox permissions
   */
  sandbox?: SandboxPermission[];

  /**
   * UI display hint override
   */
  displayAs?: 'inline' | 'modal' | 'panel';
}

<ToolResultWithUI
  result={toolResult}
  fallback={(r) => <pre>{JSON.stringify(r, null, 2)}</pre>}
  sandbox={['allow-scripts']}
  displayAs="inline"
/>;
```

## HTML Templates

### Basic Template

```typescript
function createBasicHtml(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; padding: 16px; }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
}
```

### Form Template

```typescript
function generateFormHtml(fields: FormField[], submitUrl: string, title?: string): string {
  const fieldHtml = fields
    .map((field) => {
      switch (field.type) {
        case 'text':
        case 'email':
        case 'number':
          return `
          <div class="field">
            <label for="${field.name}">${field.label}</label>
            <input
              type="${field.type}"
              id="${field.name}"
              name="${field.name}"
              ${field.required ? 'required' : ''}
            />
          </div>
        `;
        case 'select':
          return `
          <div class="field">
            <label for="${field.name}">${field.label}</label>
            <select id="${field.name}" name="${field.name}" ${field.required ? 'required' : ''}>
              ${field.options?.map((opt) => `<option value="${opt}">${opt}</option>`).join('')}
            </select>
          </div>
        `;
        case 'checkbox':
          return `
          <div class="field checkbox">
            <input type="checkbox" id="${field.name}" name="${field.name}" />
            <label for="${field.name}">${field.label}</label>
          </div>
        `;
      }
    })
    .join('\n');

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui; padding: 20px; }
    .field { margin-bottom: 16px; }
    label { display: block; margin-bottom: 4px; font-weight: 500; }
    input, select { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
    .checkbox { display: flex; align-items: center; gap: 8px; }
    .checkbox input { width: auto; }
    button { background: #0066cc; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0052a3; }
  </style>
</head>
<body>
  ${title ? `<h2>${title}</h2>` : ''}
  <form action="${submitUrl}" method="POST">
    ${fieldHtml}
    <button type="submit">Submit</button>
  </form>
</body>
</html>`;
}
```

### Chart Template

```typescript
function generateChartHtml(data: { label: string; value: number }[], type: 'bar' | 'line' | 'pie'): string {
  const chartConfig = JSON.stringify({ type, data });

  return `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    body { margin: 0; padding: 16px; }
    canvas { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <canvas id="chart"></canvas>
  <script>
    const config = ${chartConfig};
    const ctx = document.getElementById('chart').getContext('2d');
    new Chart(ctx, {
      type: config.type,
      data: {
        labels: config.data.map(d => d.label),
        datasets: [{
          data: config.data.map(d => d.value),
          backgroundColor: [
            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF'
          ],
        }],
      },
    });
  </script>
</body>
</html>`;
}
```

## Communication with Parent

UI resources can communicate with the parent application:

### Child → Parent Messages

```html
<script>
  // Send message to parent
  function sendToParent(type, payload) {
    window.parent.postMessage({ type, payload }, '*');
  }

  // Example: form submission
  document.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    sendToParent('form:submit', data);
  });

  // Example: button click
  document.querySelector('#save').addEventListener('click', () => {
    sendToParent('button:click', { action: 'save' });
  });
</script>
```

### Parent Handling

```tsx
<UIResourceRenderer
  resource={resource}
  onMessage={(message) => {
    if (message.type === 'form:submit') {
      handleFormSubmit(message.payload);
    } else if (message.type === 'button:click') {
      handleButtonClick(message.payload);
    }
  }}
/>
```

### Parent → Child Messages

```tsx
const iframeRef = useRef<HTMLIFrameElement>(null);

// Send message to child
function sendToChild(type: string, payload: unknown) {
  iframeRef.current?.contentWindow?.postMessage({ type, payload }, '*');
}

// In child HTML:
// <script>
//   window.addEventListener('message', (e) => {
//     if (e.data.type === 'update:data') {
//       updateChart(e.data.payload);
//     }
//   });
// </script>
```

## Security Considerations

1. **Always sandbox UI resources** - Never render without sandbox restrictions
2. **Validate message origins** - Check `event.origin` in message handlers
3. **Sanitize user input** - Don't inject unsanitized user data into HTML
4. **Use CSP headers** - Restrict resource loading in iframes
5. **Limit permissions** - Only grant necessary sandbox permissions

```typescript
// Secure UI resource creation
const uiResource = createUIResource({
  html: sanitizeHtml(userContent), // Sanitize any user input
  css: `
    /* CSP-safe inline styles only */
    body { font-family: system-ui; }
  `,
});

// Secure rendering
<UIResourceRenderer
  resource={resource}
  sandbox={['allow-scripts']} // Minimal permissions
  onMessage={(msg, event) => {
    // Validate origin
    if (event.origin !== 'null') {
      console.warn('Unexpected origin:', event.origin);
      return;
    }
    handleMessage(msg);
  }}
/>;
```

## Comparison with MCP-UI

| Feature                  | MCP-UI                      | FrontMCP                    |
| ------------------------ | --------------------------- | --------------------------- |
| `createUIResource()`     | Yes                         | Yes                         |
| MIME type                | `text/html;profile=mcp-app` | `text/html;profile=mcp-app` |
| `_meta.resourceUri`      | Yes                         | Yes                         |
| React component          | `UIResourceRenderer`        | `UIResourceRenderer`        |
| Sandboxed iframes        | Yes                         | Yes                         |
| Parent-child comms       | Yes                         | Yes                         |
| Valtio store integration | No                          | Yes                         |

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) - UI resource delivery architecture
- [REACT.md](./REACT.md) - React components including UIResourceRenderer
- [APP-BRIDGE.md](./APP-BRIDGE.md) - Host SDK for embedding apps
- [SECURITY.md](./SECURITY.md) - Sandboxing and security patterns
