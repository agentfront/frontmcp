# Use Cases

Real-world application patterns for FrontMCP Browser.

## Table of Contents

- [AI-Powered Documentation Platform](#ai-powered-documentation-platform)
- [Smart Form Builder](#smart-form-builder)
- [E-commerce AI Assistant](#e-commerce-ai-assistant)
- [Real-Time Collaboration Canvas](#real-time-collaboration-canvas)
- [Offline-First AI Assistant](#offline-first-ai-assistant)
- [Dashboard Analytics Tool](#dashboard-analytics-tool)

---

## AI-Powered Documentation Platform

Build a documentation platform where AI assists with content creation and users approve before publishing.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Documentation App                  │
├──────────────┬──────────────┬──────────────────────┤
│   Editor     │   Preview    │   AI Assistant       │
│   (Component)│   (Component)│   (MCP Client)       │
├──────────────┴──────────────┴──────────────────────┤
│                FrontMCP Browser Server              │
│  ┌────────────┐  ┌────────────┐  ┌───────────────┐│
│  │   Store    │  │   Tools    │  │   Resources   ││
│  │  - docs    │  │- createDoc │  │- doc://{id}   ││
│  │  - drafts  │  │- editDoc   │  │- drafts://list││
│  │  - meta    │  │- publish   │  │- published:// ││
│  └────────────┘  └────────────┘  └───────────────┘│
└─────────────────────────────────────────────────────┘
```

### Implementation

```typescript
// server.ts
const server = await createBrowserMcpServer({
  info: { name: 'DocsAI', version: '1.0.0' },
  store: {
    documents: {},
    drafts: {},
    publishedIds: [],
  },
  persistence: { name: 'docs-db' },
});

// Tools for AI to use
server.registerTool('create-document', {
  description: 'Create a new document draft',
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    content: z.string(),
    category: z.enum(['guide', 'api', 'tutorial', 'reference']),
  }),
  execute: async (args) => {
    const store = server.getStore();
    const id = crypto.randomUUID();
    const draft = {
      id,
      ...args,
      createdAt: Date.now(),
      status: 'draft',
    };

    store.state.drafts[id] = draft;

    return {
      success: true,
      draftId: id,
      _meta: {
        resourceUri: `draft://${id}`,
        uiHint: 'panel',
      },
    };
  },
});

server.registerTool('edit-section', {
  description: 'Edit a specific section of a document',
  inputSchema: z.object({
    documentId: z.string(),
    sectionId: z.string(),
    newContent: z.string(),
  }),
  execute: async (args, context) => {
    // Require HiTL confirmation
    if (!context.confirmed) {
      throw new ConfirmationRequiredError('edit-section', args);
    }

    const store = server.getStore();
    const doc = store.state.drafts[args.documentId];
    if (!doc) throw new Error('Document not found');

    // Apply edit
    doc.sections[args.sectionId] = args.newContent;
    doc.lastEditedAt = Date.now();

    return { success: true };
  },
});

server.registerTool('publish', {
  description: 'Publish a draft document',
  inputSchema: z.object({
    draftId: z.string(),
  }),
  _meta: { confirmRequired: true }, // Always require confirmation
  execute: async (args, context) => {
    const store = server.getStore();
    const draft = store.state.drafts[args.draftId];

    if (!draft) throw new Error('Draft not found');

    // Move from drafts to published
    store.state.documents[draft.id] = {
      ...draft,
      status: 'published',
      publishedAt: Date.now(),
    };
    store.state.publishedIds.push(draft.id);
    delete store.state.drafts[args.draftId];

    return {
      success: true,
      publishedUrl: `/docs/${draft.id}`,
    };
  },
});

// Resources for AI to read
server.registerResource('drafts://list', {
  name: 'Draft Documents',
  mimeType: 'application/json',
  read: async () => ({
    contents: [
      {
        uri: 'drafts://list',
        mimeType: 'application/json',
        text: JSON.stringify(Object.values(server.getStore().state.drafts)),
      },
    ],
  }),
});
```

### React Components

```tsx
function DocumentationApp() {
  return (
    <FrontMcpBrowserProvider server={server}>
      <HiTLProvider config={hitlConfig}>
        <div className="flex h-screen">
          <Sidebar />
          <Editor />
          <Preview />
          <AIAssistantPanel />
        </div>
      </HiTLProvider>
    </FrontMcpBrowserProvider>
  );
}

function AIAssistantPanel() {
  const { callTool } = useMcp();
  const [prompt, setPrompt] = useState('');

  const handleGenerate = async () => {
    const result = await callTool('create-document', {
      title: `Draft: ${prompt}`,
      content: '', // AI will generate
      category: 'guide',
    });

    // Show generated draft for review
  };

  return (
    <div className="ai-panel">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe what documentation you need..."
      />
      <button onClick={handleGenerate}>Generate Draft</button>
    </div>
  );
}
```

---

## Smart Form Builder

Create dynamic forms where AI can generate, modify, and validate form configurations.

### Store Schema

```typescript
interface FormBuilderState {
  forms: Record<string, FormDefinition>;
  activeFormId: string | null;
  submissions: Record<string, FormSubmission[]>;
}

interface FormDefinition {
  id: string;
  name: string;
  fields: FormField[];
  validation: ValidationRule[];
  createdAt: number;
}

interface FormField {
  id: string;
  type: 'text' | 'email' | 'number' | 'select' | 'checkbox' | 'textarea';
  label: string;
  name: string;
  required: boolean;
  options?: string[];
  validation?: string; // Zod schema as string
}
```

### Implementation

```typescript
const server = await createBrowserMcpServer({
  info: { name: 'FormBuilder', version: '1.0.0' },
  store: {
    forms: {},
    activeFormId: null,
    submissions: {},
  },
});

server.registerTool('create-form', {
  description: 'Create a new form from description',
  inputSchema: z.object({
    name: z.string(),
    description: z.string(),
    fields: z.array(
      z.object({
        type: z.enum(['text', 'email', 'number', 'select', 'checkbox', 'textarea']),
        label: z.string(),
        name: z.string(),
        required: z.boolean().default(false),
        options: z.array(z.string()).optional(),
      }),
    ),
  }),
  execute: async (args) => {
    const store = server.getStore();
    const id = crypto.randomUUID();

    const form: FormDefinition = {
      id,
      name: args.name,
      fields: args.fields.map((f, i) => ({
        id: `field-${i}`,
        ...f,
      })),
      validation: [],
      createdAt: Date.now(),
    };

    store.state.forms[id] = form;
    store.state.activeFormId = id;

    // Create UI resource for form preview
    const uiResource = createUIResource({
      html: generateFormPreviewHtml(form),
      title: form.name,
      width: 400,
      height: 'auto',
    });

    return {
      formId: id,
      fieldCount: form.fields.length,
      _meta: {
        resourceUri: uiResource.uri,
        uiHint: 'panel',
      },
    };
  },
});

server.registerTool('add-field', {
  description: 'Add a field to existing form',
  inputSchema: z.object({
    formId: z.string(),
    field: z.object({
      type: z.enum(['text', 'email', 'number', 'select', 'checkbox', 'textarea']),
      label: z.string(),
      name: z.string(),
      required: z.boolean().default(false),
      options: z.array(z.string()).optional(),
      afterFieldId: z.string().optional(),
    }),
  }),
  execute: async (args) => {
    const store = server.getStore();
    const form = store.state.forms[args.formId];

    if (!form) throw new Error('Form not found');

    const newField = {
      id: `field-${form.fields.length}`,
      ...args.field,
    };

    if (args.field.afterFieldId) {
      const index = form.fields.findIndex((f) => f.id === args.field.afterFieldId);
      form.fields.splice(index + 1, 0, newField);
    } else {
      form.fields.push(newField);
    }

    return { success: true, fieldId: newField.id };
  },
});

server.registerTool('validate-submission', {
  description: 'Validate form submission data',
  inputSchema: z.object({
    formId: z.string(),
    data: z.record(z.unknown()),
  }),
  execute: async (args) => {
    const store = server.getStore();
    const form = store.state.forms[args.formId];

    if (!form) throw new Error('Form not found');

    const errors: Record<string, string> = {};

    for (const field of form.fields) {
      const value = args.data[field.name];

      if (field.required && !value) {
        errors[field.name] = `${field.label} is required`;
      }

      if (field.type === 'email' && value && !isValidEmail(value as string)) {
        errors[field.name] = 'Invalid email format';
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  },
});
```

### React Integration

```tsx
function FormBuilder() {
  const { state, store } = useStore<FormBuilderState>();
  const { execute: createForm } = useTool('create-form');

  return (
    <div className="form-builder">
      <AIPrompt
        onGenerate={async (prompt) => {
          // AI generates form from natural language
          await createForm({
            name: 'Contact Form',
            description: prompt,
            fields: [], // AI fills this based on prompt
          });
        }}
      />

      {state.activeFormId && <FormEditor formId={state.activeFormId} />}

      <FormPreview />
    </div>
  );
}
```

---

## E-commerce AI Assistant

Build an AI shopping assistant that can search products, compare items, and manage cart.

### Implementation

```typescript
const server = await createBrowserMcpServer({
  info: { name: 'ShopAI', version: '1.0.0' },
  store: {
    cart: { items: [], total: 0 },
    wishlist: [],
    recentlyViewed: [],
    searchHistory: [],
  },
  persistence: { name: 'shop-db' },
});

server.registerTool('search-products', {
  description: 'Search for products by query',
  inputSchema: z.object({
    query: z.string(),
    filters: z
      .object({
        category: z.string().optional(),
        minPrice: z.number().optional(),
        maxPrice: z.number().optional(),
        inStock: z.boolean().optional(),
      })
      .optional(),
  }),
  execute: async (args) => {
    // Search product API
    const results = await searchProductsAPI(args.query, args.filters);

    // Track search
    const store = server.getStore();
    store.state.searchHistory.push({
      query: args.query,
      timestamp: Date.now(),
      resultCount: results.length,
    });

    return {
      products: results.slice(0, 10),
      totalCount: results.length,
    };
  },
});

server.registerTool('add-to-cart', {
  description: 'Add a product to shopping cart',
  inputSchema: z.object({
    productId: z.string(),
    quantity: z.number().int().min(1).default(1),
  }),
  execute: async (args) => {
    const product = await getProductById(args.productId);
    const store = server.getStore();

    const existingItem = store.state.cart.items.find((i) => i.productId === args.productId);

    if (existingItem) {
      existingItem.quantity += args.quantity;
    } else {
      store.state.cart.items.push({
        productId: args.productId,
        name: product.name,
        price: product.price,
        quantity: args.quantity,
      });
    }

    // Recalculate total
    store.state.cart.total = store.state.cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return {
      success: true,
      cartItemCount: store.state.cart.items.length,
      cartTotal: store.state.cart.total,
    };
  },
});

server.registerTool('compare-products', {
  description: 'Compare multiple products side by side',
  inputSchema: z.object({
    productIds: z.array(z.string()).min(2).max(4),
  }),
  execute: async (args) => {
    const products = await Promise.all(args.productIds.map((id) => getProductById(id)));

    // Generate comparison UI
    const uiResource = createUIResource({
      html: generateComparisonTableHtml(products),
      title: 'Product Comparison',
      width: 800,
      height: 600,
    });

    return {
      comparison: products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        rating: p.rating,
        features: p.features,
      })),
      _meta: {
        resourceUri: uiResource.uri,
        uiHint: 'modal',
      },
    };
  },
});

server.registerTool('checkout', {
  description: 'Proceed to checkout',
  inputSchema: z.object({
    shippingAddress: z
      .object({
        street: z.string(),
        city: z.string(),
        zipCode: z.string(),
        country: z.string(),
      })
      .optional(),
  }),
  _meta: { confirmRequired: true }, // Always require confirmation
  execute: async (args, context) => {
    const store = server.getStore();

    if (store.state.cart.items.length === 0) {
      throw new Error('Cart is empty');
    }

    // Create order
    const order = {
      id: crypto.randomUUID(),
      items: [...store.state.cart.items],
      total: store.state.cart.total,
      shipping: args.shippingAddress,
      createdAt: Date.now(),
    };

    // Clear cart
    store.state.cart = { items: [], total: 0 };

    return {
      orderId: order.id,
      total: order.total,
      itemCount: order.items.length,
    };
  },
});

// Resources
server.registerResource('cart://current', {
  name: 'Shopping Cart',
  mimeType: 'application/json',
  read: async () => ({
    contents: [
      {
        uri: 'cart://current',
        mimeType: 'application/json',
        text: JSON.stringify(server.getStore().state.cart),
      },
    ],
  }),
  subscribe: (_, callback) => {
    return server.getStore().subscribeKey('cart', callback);
  },
});
```

---

## Real-Time Collaboration Canvas

Build a collaborative whiteboard where AI and users can work together.

### Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Collaboration Canvas                     │
├──────────────┬──────────────┬──────────────┬──────────────┤
│   Canvas     │   Tool       │   Layers     │   AI         │
│   (Render)   │   (Palette)  │   (Panel)    │   (Assist)   │
├──────────────┴──────────────┴──────────────┴──────────────┤
│              FrontMCP Browser + BroadcastChannel           │
│  ┌────────────────┐  ┌──────────────────┐                 │
│  │  Shared Store  │  │  Real-time Sync  │                 │
│  │  - shapes      │  │  - cursor pos    │                 │
│  │  - layers      │  │  - selections    │                 │
│  │  - history     │  │  - operations    │                 │
│  └────────────────┘  └──────────────────┘                 │
└────────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
const server = await createBrowserMcpServer({
  info: { name: 'CollabCanvas', version: '1.0.0' },
  transport: new BroadcastChannelTransport('canvas-sync'),
  store: {
    shapes: {},
    layers: [{ id: 'default', name: 'Layer 1', visible: true }],
    selectedIds: [],
    history: [],
  },
});

server.registerTool('add-shape', {
  description: 'Add a shape to the canvas',
  inputSchema: z.object({
    type: z.enum(['rectangle', 'circle', 'line', 'text', 'image']),
    position: z.object({ x: z.number(), y: z.number() }),
    size: z.object({ width: z.number(), height: z.number() }).optional(),
    style: z
      .object({
        fill: z.string().optional(),
        stroke: z.string().optional(),
        strokeWidth: z.number().optional(),
      })
      .optional(),
    content: z.string().optional(), // For text shapes
  }),
  execute: async (args) => {
    const store = server.getStore();
    const id = crypto.randomUUID();

    const shape = {
      id,
      ...args,
      layerId: 'default',
      createdAt: Date.now(),
    };

    store.state.shapes[id] = shape;
    store.state.history.push({ type: 'add', shapeId: id });

    return { shapeId: id };
  },
});

server.registerTool('arrange-layout', {
  description: 'Automatically arrange shapes on canvas',
  inputSchema: z.object({
    layout: z.enum(['grid', 'circle', 'tree', 'force-directed']),
    shapeIds: z.array(z.string()).optional(), // Specific shapes or all
  }),
  execute: async (args) => {
    const store = server.getStore();
    const ids = args.shapeIds || Object.keys(store.state.shapes);
    const shapes = ids.map((id) => store.state.shapes[id]).filter(Boolean);

    // Calculate new positions based on layout algorithm
    const newPositions = calculateLayout(args.layout, shapes);

    // Apply positions
    newPositions.forEach(({ id, position }) => {
      if (store.state.shapes[id]) {
        store.state.shapes[id].position = position;
      }
    });

    return { arranged: ids.length };
  },
});

server.registerTool('generate-diagram', {
  description: 'Generate a diagram from description',
  inputSchema: z.object({
    description: z.string(),
    type: z.enum(['flowchart', 'mindmap', 'org-chart', 'sequence']),
  }),
  execute: async (args) => {
    // AI generates diagram structure
    const diagramStructure = await aiGenerateDiagram(args);

    const store = server.getStore();
    const shapeIds: string[] = [];

    // Create shapes for each node
    for (const node of diagramStructure.nodes) {
      const id = crypto.randomUUID();
      store.state.shapes[id] = {
        id,
        type: 'rectangle',
        position: node.position,
        size: { width: 120, height: 60 },
        style: { fill: '#fff', stroke: '#333' },
        content: node.label,
      };
      shapeIds.push(id);
    }

    // Create lines for connections
    for (const edge of diagramStructure.edges) {
      const id = crypto.randomUUID();
      store.state.shapes[id] = {
        id,
        type: 'line',
        from: edge.from,
        to: edge.to,
        style: { stroke: '#666' },
      };
      shapeIds.push(id);
    }

    return {
      generated: shapeIds.length,
      shapeIds,
    };
  },
});
```

---

## Offline-First AI Assistant

Build an AI assistant that works offline using cached data and syncs when online.

### Implementation

```typescript
const server = await createBrowserMcpServer({
  info: { name: 'OfflineAI', version: '1.0.0' },
  store: {
    messages: [],
    pendingActions: [],
    syncStatus: 'synced',
    lastSyncAt: null,
    cachedResponses: {},
  },
  persistence: {
    name: 'offline-ai-db',
    storage: 'indexeddb',
  },
});

// Sync manager
const syncManager = {
  isOnline: navigator.onLine,

  async sync() {
    const store = server.getStore();
    store.state.syncStatus = 'syncing';

    try {
      // Process pending actions
      for (const action of store.state.pendingActions) {
        await processActionOnServer(action);
      }

      store.state.pendingActions = [];
      store.state.lastSyncAt = Date.now();
      store.state.syncStatus = 'synced';
    } catch (error) {
      store.state.syncStatus = 'error';
    }
  },
};

// Listen for online/offline
window.addEventListener('online', () => syncManager.sync());
window.addEventListener('offline', () => {
  server.getStore().state.syncStatus = 'offline';
});

server.registerTool('send-message', {
  description: 'Send a message to the AI',
  inputSchema: z.object({
    content: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
  execute: async (args) => {
    const store = server.getStore();
    const messageId = crypto.randomUUID();

    // Add user message
    store.state.messages.push({
      id: messageId,
      role: 'user',
      content: args.content,
      timestamp: Date.now(),
    });

    if (navigator.onLine) {
      // Online: Get real response
      const response = await getAIResponse(args.content);
      store.state.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      });

      // Cache response pattern
      const cacheKey = generateCacheKey(args.content);
      store.state.cachedResponses[cacheKey] = response;

      return { response };
    } else {
      // Offline: Use cached or queue
      const cacheKey = generateCacheKey(args.content);
      const cached = store.state.cachedResponses[cacheKey];

      if (cached) {
        store.state.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: cached,
          timestamp: Date.now(),
          fromCache: true,
        });
        return { response: cached, fromCache: true };
      }

      // Queue for when online
      store.state.pendingActions.push({
        type: 'message',
        messageId,
        content: args.content,
        timestamp: Date.now(),
      });

      return {
        queued: true,
        message: 'Response will be available when online',
      };
    }
  },
});

// Service Worker registration for full offline support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
```

---

## Dashboard Analytics Tool

Build an analytics dashboard where AI can generate charts and insights.

### Implementation

```typescript
const server = await createBrowserMcpServer({
  info: { name: 'AnalyticsAI', version: '1.0.0' },
  store: {
    dashboards: {},
    activeDashboard: null,
    dataCache: {},
    insights: [],
  },
});

server.registerTool('create-chart', {
  description: 'Create a chart visualization',
  inputSchema: z.object({
    type: z.enum(['line', 'bar', 'pie', 'area', 'scatter']),
    title: z.string(),
    data: z.array(
      z.object({
        label: z.string(),
        value: z.number(),
      }),
    ),
    options: z
      .object({
        xAxis: z.string().optional(),
        yAxis: z.string().optional(),
        colors: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  execute: async (args) => {
    const uiResource = createUIResource({
      html: generateChartHtml(args),
      title: args.title,
      width: 600,
      height: 400,
      scripts: ['https://cdn.jsdelivr.net/npm/chart.js@4'],
    });

    const store = server.getStore();
    const chartId = crypto.randomUUID();

    if (store.state.activeDashboard) {
      store.state.dashboards[store.state.activeDashboard].charts.push({
        id: chartId,
        ...args,
        resourceUri: uiResource.uri,
      });
    }

    return {
      chartId,
      _meta: {
        resourceUri: uiResource.uri,
        uiHint: 'inline',
      },
    };
  },
});

server.registerTool('analyze-data', {
  description: 'Analyze data and generate insights',
  inputSchema: z.object({
    datasetId: z.string(),
    analysisType: z.enum(['trend', 'anomaly', 'correlation', 'summary']),
  }),
  execute: async (args) => {
    const store = server.getStore();
    const data = store.state.dataCache[args.datasetId];

    if (!data) throw new Error('Dataset not found');

    // Perform analysis
    const insights = analyzeData(data, args.analysisType);

    // Store insights
    store.state.insights.push(
      ...insights.map((i) => ({
        id: crypto.randomUUID(),
        datasetId: args.datasetId,
        ...i,
        createdAt: Date.now(),
      })),
    );

    return {
      insights,
      recommendedCharts: insights.map((i) => i.suggestedVisualization),
    };
  },
});

server.registerTool('create-dashboard', {
  description: 'Create a new dashboard',
  inputSchema: z.object({
    name: z.string(),
    layout: z.enum(['grid', 'freeform']).default('grid'),
  }),
  execute: async (args) => {
    const store = server.getStore();
    const id = crypto.randomUUID();

    store.state.dashboards[id] = {
      id,
      name: args.name,
      layout: args.layout,
      charts: [],
      filters: {},
      createdAt: Date.now(),
    };

    store.state.activeDashboard = id;

    return { dashboardId: id };
  },
});
```

---

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design patterns
- [REACT.md](./REACT.md) - React integration details
- [STORE.md](./STORE.md) - Store patterns and persistence
- [APP-BRIDGE.md](./APP-BRIDGE.md) - Embedding MCP apps
