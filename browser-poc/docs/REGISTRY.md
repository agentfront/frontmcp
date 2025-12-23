# Component Registry

System for registering UI components as MCP resources and renderers as MCP tools.

## Core Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                      Developer Registers                         │
│                                                                  │
│   Components (UI definitions)  →  MCP Resources (discoverable)   │
│   Renderers (render functions) →  MCP Tools (executable)         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        AI Agent Can                              │
│                                                                  │
│   1. List components:   resources/list → component://*           │
│   2. Read component:    resources/read → component://Button      │
│   3. Render component:  tools/call → { name: 'render', ... }     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Component Registry

### Interface

```typescript
interface ComponentDefinition<Props = unknown> {
  /**
   * Unique component name
   */
  name: string;

  /**
   * Human-readable description for AI
   */
  description: string;

  /**
   * Props schema (Zod)
   */
  propsSchema: ZodSchema<Props>;

  /**
   * Default props values
   */
  defaultProps?: Partial<Props>;

  /**
   * Component category for organization
   */
  category?: string;

  /**
   * Tags for search/filtering
   */
  tags?: string[];

  /**
   * Example usage for AI context
   */
  examples?: ComponentExample[];
}

interface ComponentExample {
  description: string;
  props: unknown;
}

interface ComponentRegistry {
  /**
   * Register a component
   */
  register<Props>(definition: ComponentDefinition<Props>): void;

  /**
   * Get component by name
   */
  get(name: string): ComponentDefinition | undefined;

  /**
   * List all registered components
   */
  list(): ComponentDefinition[];

  /**
   * List components by category
   */
  listByCategory(category: string): ComponentDefinition[];

  /**
   * Search components by tags
   */
  search(tags: string[]): ComponentDefinition[];

  /**
   * Check if component exists
   */
  has(name: string): boolean;
}
```

### Implementation

```typescript
import { z } from 'zod';

class ComponentRegistryImpl implements ComponentRegistry {
  private components = new Map<string, ComponentDefinition>();

  register<Props>(definition: ComponentDefinition<Props>): void {
    if (this.components.has(definition.name)) {
      throw new Error(`Component "${definition.name}" already registered`);
    }
    this.components.set(definition.name, definition);
  }

  get(name: string): ComponentDefinition | undefined {
    return this.components.get(name);
  }

  list(): ComponentDefinition[] {
    return Array.from(this.components.values());
  }

  listByCategory(category: string): ComponentDefinition[] {
    return this.list().filter((c) => c.category === category);
  }

  search(tags: string[]): ComponentDefinition[] {
    return this.list().filter((c) => tags.some((tag) => c.tags?.includes(tag)));
  }

  has(name: string): boolean {
    return this.components.has(name);
  }
}

export function createComponentRegistry(): ComponentRegistry {
  return new ComponentRegistryImpl();
}
```

### Usage Example

```typescript
const registry = createComponentRegistry();

// Register a Button component
registry.register({
  name: 'Button',
  description: 'A clickable button that triggers actions',
  category: 'inputs',
  tags: ['interactive', 'form', 'action'],
  propsSchema: z.object({
    label: z.string().describe('Button text'),
    variant: z.enum(['primary', 'secondary', 'danger']).default('primary'),
    disabled: z.boolean().default(false),
    onClick: z.string().optional().describe('Action name to trigger'),
  }),
  defaultProps: {
    variant: 'primary',
    disabled: false,
  },
  examples: [
    {
      description: 'Primary submit button',
      props: { label: 'Submit', variant: 'primary' },
    },
    {
      description: 'Danger delete button',
      props: { label: 'Delete', variant: 'danger' },
    },
  ],
});

// Register a Form component
registry.register({
  name: 'Form',
  description: 'A dynamic form with configurable fields',
  category: 'inputs',
  tags: ['form', 'input', 'interactive'],
  propsSchema: z.object({
    fields: z.array(
      z.object({
        name: z.string(),
        type: z.enum(['text', 'number', 'email', 'select', 'checkbox']),
        label: z.string(),
        required: z.boolean().default(false),
        options: z.array(z.string()).optional(),
      }),
    ),
    submitLabel: z.string().default('Submit'),
    onSubmit: z.string().describe('Action name to trigger on submit'),
  }),
  examples: [
    {
      description: 'Login form',
      props: {
        fields: [
          { name: 'email', type: 'email', label: 'Email', required: true },
          { name: 'password', type: 'text', label: 'Password', required: true },
        ],
        submitLabel: 'Login',
      },
    },
  ],
});
```

---

## MCP Resource Integration

### Component List Resource

```typescript
@Resource({
  uri: 'components://list',
  name: 'Component List',
  description: 'List all available UI components',
})
class ComponentListResource extends ResourceEntry {
  constructor(private registry: ComponentRegistry) {}

  async read(ctx: ResourceContext) {
    const components = this.registry.list().map((c) => ({
      name: c.name,
      description: c.description,
      category: c.category,
      tags: c.tags,
    }));

    return {
      contents: [
        {
          uri: 'components://list',
          mimeType: 'application/json',
          text: JSON.stringify(components, null, 2),
        },
      ],
    };
  }
}
```

### Single Component Resource

```typescript
@Resource({
  uri: 'component://{name}',
  name: 'Component Definition',
  description: 'Get full definition of a UI component',
})
class ComponentResource extends ResourceEntry {
  constructor(private registry: ComponentRegistry) {}

  async read(ctx: ResourceContext) {
    const { name } = ctx.params;
    const component = this.registry.get(name);

    if (!component) {
      throw new ResourceNotFoundError(`Component "${name}" not found`);
    }

    // Convert Zod schema to JSON Schema for AI consumption
    const jsonSchema = zodToJsonSchema(component.propsSchema);

    return {
      contents: [
        {
          uri: `component://${name}`,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              name: component.name,
              description: component.description,
              category: component.category,
              tags: component.tags,
              propsSchema: jsonSchema,
              defaultProps: component.defaultProps,
              examples: component.examples,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
```

---

## Renderer Registry

### Interface

```typescript
interface RendererDefinition<Props = unknown, Result = unknown> {
  /**
   * Unique renderer name (becomes tool name)
   */
  name: string;

  /**
   * Description for AI
   */
  description: string;

  /**
   * Input schema (component + props + target)
   */
  inputSchema: ZodSchema;

  /**
   * The render function
   */
  render: (input: RenderInput<Props>) => Promise<Result>;
}

interface RenderInput<Props> {
  /**
   * Component name to render
   */
  component: string;

  /**
   * Props to pass to component
   */
  props: Props;

  /**
   * DOM target (selector or element ID)
   */
  target?: string;
}

interface RendererRegistry {
  register(renderer: RendererDefinition): void;
  get(name: string): RendererDefinition | undefined;
  list(): RendererDefinition[];
}
```

### Implementation

```typescript
class RendererRegistryImpl implements RendererRegistry {
  private renderers = new Map<string, RendererDefinition>();

  register(renderer: RendererDefinition): void {
    this.renderers.set(renderer.name, renderer);
  }

  get(name: string): RendererDefinition | undefined {
    return this.renderers.get(name);
  }

  list(): RendererDefinition[] {
    return Array.from(this.renderers.values());
  }
}

export function createRendererRegistry(): RendererRegistry {
  return new RendererRegistryImpl();
}
```

---

## MCP Tool Integration

### Generic Render Tool

```typescript
@Tool({
  name: 'render',
  description: 'Render a registered UI component',
  inputSchema: z.object({
    component: z.string().describe('Name of the component to render'),
    props: z.record(z.unknown()).describe('Props to pass to the component'),
    target: z.string().optional().describe('DOM selector or element ID'),
  }),
})
class RenderTool extends ToolEntry {
  constructor(private componentRegistry: ComponentRegistry, private rendererRegistry: RendererRegistry) {}

  async execute(ctx: ToolContext) {
    const { component, props, target } = ctx.input;

    // Validate component exists
    const componentDef = this.componentRegistry.get(component);
    if (!componentDef) {
      throw new ToolExecutionError(`Component "${component}" not found`);
    }

    // Validate props against schema
    const validatedProps = componentDef.propsSchema.parse(props);

    // Get default renderer
    const renderer = this.rendererRegistry.get('default');
    if (!renderer) {
      throw new ToolExecutionError('No default renderer registered');
    }

    // Execute render
    const result = await renderer.render({
      component,
      props: validatedProps,
      target,
    });

    return {
      success: true,
      component,
      rendered: true,
      ...result,
    };
  }
}
```

### Specialized Render Tools

Developers can register specialized renderers:

```typescript
// Form renderer with validation
rendererRegistry.register({
  name: 'render-form',
  description: 'Render a form with validation',
  inputSchema: z.object({
    fields: z.array(FieldSchema),
    onSubmit: z.string(),
    target: z.string().optional(),
  }),
  async render(input) {
    // Custom form rendering logic
    const formId = generateId();
    // ... render form to DOM
    return { formId, fields: input.fields.length };
  },
});

// Code editor renderer
rendererRegistry.register({
  name: 'render-code-editor',
  description: 'Render a code editor',
  inputSchema: z.object({
    language: z.string(),
    initialCode: z.string().optional(),
    readOnly: z.boolean().default(false),
    target: z.string().optional(),
  }),
  async render(input) {
    // Initialize Monaco or CodeMirror
    return { editorId: generateId() };
  },
});

// Chart renderer
rendererRegistry.register({
  name: 'render-chart',
  description: 'Render a data chart',
  inputSchema: z.object({
    type: z.enum(['bar', 'line', 'pie', 'scatter']),
    data: z.array(z.record(z.unknown())),
    options: z.record(z.unknown()).optional(),
    target: z.string().optional(),
  }),
  async render(input) {
    // Use Chart.js or similar
    return { chartId: generateId() };
  },
});
```

---

## React Integration

For React applications, components can be actual React components:

```typescript
interface ReactComponentDefinition<Props> extends ComponentDefinition<Props> {
  /**
   * The actual React component
   */
  Component: React.ComponentType<Props>;
}

// Registration
registry.register({
  name: 'UserCard',
  description: 'Display user information',
  propsSchema: z.object({
    name: z.string(),
    email: z.string(),
    avatar: z.string().optional(),
  }),
  Component: UserCardComponent, // React component
});

// React renderer
rendererRegistry.register({
  name: 'react',
  description: 'Render React components',
  async render({ component, props, target }) {
    const def = registry.get(component) as ReactComponentDefinition;
    const container = document.querySelector(target) || document.body;

    const root = createRoot(container);
    root.render(<def.Component {...props} />);

    return { containerId: container.id };
  },
});
```

---

## File Structure

```
browser-poc/src/registry/
├── component.registry.ts       # ComponentRegistry implementation
├── renderer.registry.ts        # RendererRegistry implementation
├── mcp-resources.ts            # MCP resource implementations
├── mcp-tools.ts                # MCP tool implementations
├── types.ts                    # TypeScript interfaces
└── index.ts                    # Barrel exports
```

---

## AI Interaction Flow

```
AI Agent                                    Browser App
    │                                            │
    │─── resources/list ────────────────────────▶│
    │◀── [Button, Form, Chart, ...] ─────────────│
    │                                            │
    │─── resources/read component://Form ───────▶│
    │◀── { propsSchema, examples, ... } ─────────│
    │                                            │
    │─── tools/call render ─────────────────────▶│
    │    { component: 'Form',                    │
    │      props: { fields: [...] },             │
    │      target: '#app' }                      │
    │◀── { success: true, formId: '...' } ───────│
    │                                            │
    │                                    ┌───────┴───────┐
    │                                    │  Form renders │
    │                                    │   in #app     │
    │                                    └───────────────┘
```

---

## Testing

```typescript
describe('ComponentRegistry', () => {
  it('should register components');
  it('should prevent duplicate registration');
  it('should list all components');
  it('should filter by category');
  it('should search by tags');
});

describe('RendererRegistry', () => {
  it('should register renderers');
  it('should execute render functions');
  it('should validate props against schema');
});

describe('MCP Integration', () => {
  it('should expose components as resources');
  it('should render via tools');
  it('should return proper JSON Schema');
});
```
