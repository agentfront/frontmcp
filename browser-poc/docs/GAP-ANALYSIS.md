# Gap Analysis: FrontMCP Browser vs Competitors

Comprehensive analysis of gaps, missing features, and opportunities to make FrontMCP Browser the best frontend MCP server for UI components.

> **Last Updated**: December 2025
>
> **Competitors Analyzed**:
>
> - [WebMCP](https://docs.mcp-b.ai) - W3C standard for AI-accessible websites via `navigator.modelContext`
> - [MCP-UI](https://mcpui.dev) - Protocol for rich UI in agentic apps with sandboxed iframes

---

## Executive Summary

FrontMCP Browser has unique strengths (Valtio reactive store, component registry, persistence) but needs significant enhancements to match competitors in key areas like W3C standard alignment and app embedding.

| Category      | Critical | High   | Medium | Low    |
| ------------- | -------- | ------ | ------ | ------ |
| Core Features | 4        | 4      | 3      | 2      |
| UI Components | 2        | 4      | 3      | 2      |
| Security      | 1        | 2      | 2      | 1      |
| Performance   | 0        | 3      | 3      | 2      |
| DX/Tooling    | 1        | 3      | 4      | 3      |
| **Total**     | **8**    | **16** | **15** | **10** |

---

## Three-Way Competitor Comparison

### Feature Matrix

| Feature                    | WebMCP        | MCP-UI         | FrontMCP                          | Notes                |
| -------------------------- | ------------- | -------------- | --------------------------------- | -------------------- |
| **Transport**              |
| PostMessage Transport      | Yes           | Yes            | Yes                               | Parity               |
| EventEmitter Transport     | No            | No             | Yes                               | **Advantage**        |
| BroadcastChannel Transport | No            | No             | Yes                               | **Advantage**        |
| Tab Transport              | Yes           | No             | No                                | Gap                  |
| Extension Transport        | Yes           | No             | No                                | Gap                  |
| Iframe Transport           | Yes           | Yes            | No                                | Gap                  |
| **State Management**       |
| Reactive Store             | No            | No             | Yes (Valtio)                      | **Strong Advantage** |
| Store Persistence          | No            | No             | Yes (IndexedDB)                   | **Strong Advantage** |
| Store Subscriptions        | No            | No             | Yes                               | **Advantage**        |
| **Component System**       |
| Component Registry         | Basic         | Basic          | Full                              | **Advantage**        |
| Zod Schema Validation      | Yes           | No             | Yes                               | Parity with WebMCP   |
| Component Metadata         | Basic         | Basic          | Full (categories, tags, examples) | **Advantage**        |
| **UI Rendering**           |
| HTML Resource Delivery     | No            | Yes            | No                                | Gap                  |
| UIResourceRenderer         | No            | Yes            | No                                | Gap                  |
| Sandboxed Iframes          | No            | Yes            | No                                | Gap                  |
| **W3C Standard**           |
| navigator.modelContext     | Yes           | No             | No                                | Gap                  |
| Dynamic Tool Management    | Yes           | No             | No                                | Gap                  |
| **Developer Experience**   |
| React Hooks                | Yes           | Yes            | Yes                               | Parity               |
| Web Components             | Via framework | Yes            | No                                | Gap                  |
| Multi-language SDKs        | JS only       | TS/Python/Ruby | TS only                           | Gap                  |
| **Security**               |
| Human-in-the-Loop          | Core feature  | Sandboxed      | Not documented                    | Gap                  |
| Chrome Extension Wrappers  | 62+ APIs      | No             | No                                | Gap                  |

---

## Competitor 1: WebMCP (docs.mcp-b.ai)

### What WebMCP Does Well

| Feature                      | Description                                   | Impact                          |
| ---------------------------- | --------------------------------------------- | ------------------------------- |
| `navigator.modelContext` API | W3C standard alignment for browser-native MCP | Industry standard compatibility |
| TabServerTransport           | Persistent connections across page navigation | Better UX for multi-page apps   |
| ExtensionServerTransport     | Chrome Extension API bridge                   | Desktop AI client integration   |
| Chrome Extension Wrappers    | 62+ Chrome APIs exposed to AI                 | Rich browser automation         |
| Human-in-the-Loop (HiTL)     | Core philosophy - user confirms actions       | Security-first design           |
| Smart DOM Reader             | Token-efficient DOM extraction                | Better AI context               |
| Dynamic Tool Management      | Add/remove tools after connection             | Runtime flexibility             |

### WebMCP Weaknesses

| Weakness                 | FrontMCP Opportunity                 |
| ------------------------ | ------------------------------------ |
| No reactive store        | Valtio integration is unique value   |
| No persistence layer     | IndexedDB support differentiates     |
| Basic component registry | Full metadata system advantage       |
| JS-only                  | Same limitation (acceptable for now) |

### Key API Patterns from WebMCP

```typescript
// WebMCP's navigator.modelContext pattern
const mcp = await navigator.modelContext.connect();
mcp.registerTool('search', {
  /* ... */
});
mcp.registerResource('documents', {
  /* ... */
});

// FrontMCP should support similar pattern via polyfill
```

---

## Competitor 2: MCP-UI (mcpui.dev)

### What MCP-UI Does Well

| Feature                     | Description                        | Impact                       |
| --------------------------- | ---------------------------------- | ---------------------------- |
| `createUIResource()`        | HTML resource delivery from tools  | AI can receive renderable UI |
| `UIResourceRenderer`        | React component for rendering      | Easy integration             |
| Sandboxed Iframes           | Security isolation for rendered UI | Safe execution               |
| Multi-language SDKs         | TypeScript, Python, Ruby           | Broader adoption             |
| `text/html;profile=mcp-app` | MIME type for MCP UI resources     | Standard format              |
| External URL Resources      | Load UI from external URLs         | Flexible deployment          |

### MCP-UI Weaknesses

| Weakness                   | FrontMCP Opportunity            |
| -------------------------- | ------------------------------- |
| No reactive store          | Valtio integration              |
| No store persistence       | IndexedDB support               |
| React-focused client       | Framework agnostic core         |
| No dynamic tool management | Could add post-connection tools |

### Key API Patterns from MCP-UI

```typescript
// MCP-UI's createUIResource pattern
import { createUIResource } from '@anthropic-ai/mcp-apps-sdk';

return {
  content: [
    createUIResource({
      html: '<form>...</form>',
      title: 'Contact Form',
    }),
  ],
  _meta: {
    'mcp:resourceUri': 'ui://form/contact',
  },
};

// FrontMCP should support similar pattern
```

---

## FrontMCP Competitive Advantages

### Strong Differentiators

| Advantage                    | Description                                                | Competitor Status                    |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------ |
| **Valtio Reactive Store**    | Built-in proxy-based reactive state (~1KB)                 | Neither competitor has this          |
| **Component Registry**       | Full metadata with categories, tags, examples, Zod schemas | More comprehensive than both         |
| **Store Persistence**        | Built-in IndexedDB/localStorage                            | Neither competitor has this          |
| **Security Documentation**   | Comprehensive threat model, CSP, sandboxing                | Better documented than both          |
| **Framework Agnostic Store** | Works with React, Vue, Svelte, vanilla JS                  | WebMCP similar, MCP-UI React-focused |
| **Multiple Transports**      | EventEmitter, PostMessage, BroadcastChannel                | Most options of all three            |

### Positioning Statement

> **FrontMCP Browser**: The most complete frontend MCP solution for AI-powered UI. Unlike basic MCP extensions, FrontMCP provides a full reactive store with persistence, comprehensive component system with Zod validation, and multiple transport options - while maintaining W3C standard compatibility.

---

## Critical Feature Gaps (Must Fix)

### 1. navigator.modelContext Polyfill

**Priority**: CRITICAL
**Competitor**: WebMCP
**Effort**: Large

WebMCP aligns with W3C standard via `navigator.modelContext` API. FrontMCP should provide a polyfill for compatibility.

**Impact**: Without this, FrontMCP apps won't work in AI browsers expecting the standard API.

**Recommendation**: Create polyfill in `@frontmcp/browser/polyfill`:

```typescript
// polyfill.ts
import { createBrowserMcpServer } from '@frontmcp/browser';

if (!navigator.modelContext) {
  const server = await createBrowserMcpServer({
    /* config */
  });

  (navigator as any).modelContext = {
    connect: async () => server,
    registerTool: (name, def) => server.registerTool(name, def),
    registerResource: (name, def) => server.registerResource(name, def),
    registerPrompt: (name, def) => server.registerPrompt(name, def),
    isConnected: () => server.isConnected(),
    disconnect: () => server.close(),
  };
}
```

**New Documentation**: `docs/NAVIGATOR-MODEL-CONTEXT.md`

---

### 2. App Bridge / Host SDK

**Priority**: CRITICAL
**Competitors**: WebMCP (IframeParentTransport), MCP-UI (UIResourceRenderer)
**Effort**: Large

Both competitors provide SDKs for hosts (Claude Desktop, chat UIs) to embed MCP apps. FrontMCP has no equivalent.

**Impact**: Without an app bridge, hosts cannot easily embed FrontMCP apps.

**Recommendation**: Create `@frontmcp/browser/host` package:

```typescript
// host.ts - For applications hosting FrontMCP apps
import { createAppHost, IframeTransport } from '@frontmcp/browser/host';

const host = createAppHost({
  container: '#app-container',
  sandbox: ['allow-scripts', 'allow-same-origin'],
  allowedOrigins: ['https://trusted-app.com'],
  csp: "default-src 'self'; script-src 'self'",
  onToolCall: async (name, args) => {
    // Forward to AI for execution
    return await ai.callTool(name, args);
  },
  onResourceRequest: async (uri) => {
    // Forward to AI for resource read
    return await ai.readResource(uri);
  },
});

// Load an app
const connection = await host.loadApp('https://my-app.com/frontmcp-app.html');

// Bi-directional communication
connection.on('message', (msg) => console.log('App said:', msg));
connection.send({ type: 'config', data: { theme: 'dark' } });
```

**New Documentation**: `docs/APP-BRIDGE.md`

---

### 3. UI HTML Resource Delivery

**Priority**: CRITICAL
**Competitor**: MCP-UI
**Effort**: Medium

MCP-UI tools can return complete HTML for iframe rendering via `createUIResource()`.

**Impact**: AI cannot receive renderable UI from FrontMCP tools.

**Recommendation**: Add HTML resource pattern:

```typescript
// Helper function
export function createUIResource(options: {
  html: string;
  title?: string;
  width?: number;
  height?: number;
}): ResourceContent {
  return {
    type: 'resource',
    resource: {
      uri: `ui://${crypto.randomUUID()}`,
      mimeType: 'text/html;profile=mcp-app',
      text: options.html,
    },
  };
}

// Tool usage
@Tool({
  name: 'render-form',
  description: 'Render a form and return HTML',
})
class RenderFormTool {
  async execute(ctx) {
    const html = await this.renderer.renderToString(ctx.input);
    return {
      content: [createUIResource({ html, title: 'Contact Form' })],
      _meta: {
        'mcp:resourceUri': 'ui://form/rendered',
      },
    };
  }
}
```

**New Documentation**: `docs/UI-RESOURCES.md`

---

### 4. Tool-to-UI Linking (\_meta Pattern)

**Priority**: CRITICAL
**Competitors**: WebMCP, MCP-UI (both use this)
**Effort**: Small

Both competitors use `_meta.resourceUri` to link tools to their UI resources.

**Impact**: AI cannot discover which UI resource corresponds to a tool.

**Recommendation**: Document and implement `_meta` pattern:

```typescript
// In tool response
return {
  content: [{ type: 'text', text: 'Form rendered successfully' }],
  _meta: {
    'mcp:resourceUri': 'component://Form', // Component definition
    'mcp:instanceUri': 'ui://form/abc123', // Specific instance
    'mcp:htmlUri': 'ui://form/abc123/html', // HTML resource
  },
};
```

---

## High Priority Gaps

### 5. Chrome Extension Transport

**Priority**: HIGH
**Competitor**: WebMCP (ExtensionServerTransport)
**Effort**: Medium

WebMCP provides ExtensionServerTransport for Chrome Extension communication and wraps 62+ Chrome APIs.

**Recommendation**: Create `ExtensionServerTransport`:

```typescript
// extension-transport.ts
export class ExtensionServerTransport implements BrowserTransport {
  constructor(private port: chrome.runtime.Port) {}

  send(message: JSONRPCMessage): void {
    this.port.postMessage({ type: 'mcp', payload: message });
  }

  onMessage(handler: MessageHandler): () => void {
    const listener = (msg: any) => {
      if (msg.type === 'mcp') handler(msg.payload);
    };
    this.port.onMessage.addListener(listener);
    return () => this.port.onMessage.removeListener(listener);
  }

  close(): void {
    this.port.disconnect();
  }
}
```

**New Documentation**: `docs/CHROME-EXTENSION.md`

---

### 6. Human-in-the-Loop Workflows

**Priority**: HIGH
**Competitor**: WebMCP (core feature)
**Effort**: Medium

WebMCP makes HiTL a core philosophy - user confirms sensitive actions.

**Recommendation**: Document HiTL patterns and add utilities:

```typescript
// hitl.ts
interface HiTLConfig {
  requireConfirmation: boolean;
  confirmationTimeout: number;
  allowedWithoutConfirmation: string[];
}

async function withConfirmation<T>(action: string, execute: () => Promise<T>, config: HiTLConfig): Promise<T> {
  if (config.allowedWithoutConfirmation.includes(action)) {
    return execute();
  }

  const confirmed = await showConfirmationDialog({
    title: 'Action Confirmation',
    message: `The AI wants to: ${action}`,
    timeout: config.confirmationTimeout,
  });

  if (!confirmed) {
    throw new UserDeclinedError(action);
  }

  return execute();
}
```

**New Documentation**: `docs/HUMAN-IN-THE-LOOP.md`

---

### 7. TabServerTransport

**Priority**: HIGH
**Competitor**: WebMCP
**Effort**: Medium

WebMCP's TabServerTransport maintains persistent connections across page navigation.

**Recommendation**: Add to transport layer:

```typescript
// tab-transport.ts
export class TabServerTransport implements BrowserTransport {
  private channel: BroadcastChannel;
  private sessionId: string;

  constructor(options: { channelName: string }) {
    this.sessionId = sessionStorage.getItem('mcp-session') || crypto.randomUUID();
    sessionStorage.setItem('mcp-session', this.sessionId);
    this.channel = new BroadcastChannel(options.channelName);
  }

  // Persist connection across navigation
  async reconnect(): Promise<void> {
    const savedState = sessionStorage.getItem(`mcp-state-${this.sessionId}`);
    if (savedState) {
      await this.restoreState(JSON.parse(savedState));
    }
  }
}
```

---

### 8. Component Instance Registry

**Priority**: HIGH
**Effort**: Medium

Components are stateless definitions. No way to track rendered component instances.

**Recommendation**: Add component instance registry:

```typescript
interface ComponentInstance {
  id: string;
  componentName: string;
  props: unknown;
  state: unknown;
  target: string;
  createdAt: number;
  lastUpdated: number;
}

interface InstanceRegistry {
  create(name: string, props: unknown, target: string): ComponentInstance;
  get(id: string): ComponentInstance | undefined;
  update(id: string, state: Partial<unknown>): void;
  destroy(id: string): void;
  list(): ComponentInstance[];
  listByComponent(name: string): ComponentInstance[];
}

// MCP Resources
// instance://{id}         - Get instance state
// instances://list        - List all instances
// instances://component/{name} - List instances of component

// MCP Tools
// instance-update         - Update instance state
// instance-destroy        - Remove instance
// instance-event          - Trigger instance event
```

**New Documentation**: `docs/COMPONENT-INSTANCES.md`

---

## Medium Priority Gaps

### 9. Multi-language SDKs

**Priority**: MEDIUM
**Competitor**: MCP-UI (TypeScript, Python, Ruby)
**Effort**: Large

MCP-UI provides server SDKs in multiple languages.

**Recommendation**: Consider Python and Ruby SDKs for future phases. Focus on TypeScript excellence first.

---

### 10. Web Components Support

**Priority**: MEDIUM
**Competitor**: MCP-UI
**Effort**: Medium

MCP-UI provides Web Components alongside React.

**Recommendation**: Create Web Components wrapper:

```typescript
// web-components.ts
import { createMcpStore } from '@frontmcp/browser';

class FrontMcpElement extends HTMLElement {
  private store = createMcpStore({});

  connectedCallback() {
    // Initialize MCP connection
  }

  disconnectedCallback() {
    // Cleanup
  }
}

customElements.define('frontmcp-app', FrontMcpElement);
```

**New Documentation**: `docs/WEB-COMPONENTS.md`

---

### 11. Layout Components

**Priority**: MEDIUM
**Effort**: Medium

Only individual components documented. No layout system.

**Recommendation**: Add layout primitives:

```typescript
const layoutComponents = [
  {
    name: 'Stack',
    description: 'Vertical or horizontal stack layout',
    propsSchema: z.object({
      direction: z.enum(['vertical', 'horizontal']),
      gap: z.number().optional(),
      align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
      children: z.array(z.string()),
    }),
  },
  {
    name: 'Grid',
    description: 'CSS Grid layout',
    propsSchema: z.object({
      columns: z.union([z.number(), z.string()]),
      rows: z.union([z.number(), z.string()]).optional(),
      gap: z.number().optional(),
      children: z.array(z.string()),
    }),
  },
  {
    name: 'Container',
    description: 'Centered container with max-width',
    propsSchema: z.object({
      maxWidth: z.enum(['sm', 'md', 'lg', 'xl', 'full']),
      padding: z.number().optional(),
      children: z.array(z.string()),
    }),
  },
];
```

---

### 12. Theming System

**Priority**: MEDIUM
**Effort**: Medium

No theming or design token support.

**Recommendation**: Add theme provider:

```typescript
interface Theme {
  colors: {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    error: string;
    text: string;
    textMuted: string;
  };
  typography: {
    fontFamily: string;
    fontSize: Record<'xs' | 'sm' | 'base' | 'lg' | 'xl', string>;
    fontWeight: Record<'normal' | 'medium' | 'bold', number>;
  };
  spacing: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string>;
  borderRadius: Record<'sm' | 'md' | 'lg' | 'full', string>;
  shadows: Record<'sm' | 'md' | 'lg', string>;
}

// Theme resources
// theme://current - Get current theme
// theme://tokens - Get design tokens

// Theme tool
// theme-set - Update theme
```

---

## New Documentation Files Needed

| File                                 | Purpose                           | Priority | Status                                |
| ------------------------------------ | --------------------------------- | -------- | ------------------------------------- |
| `docs/NAVIGATOR-MODEL-CONTEXT.md`    | W3C polyfill specification        | CRITICAL | **Created**                           |
| `docs/APP-BRIDGE.md`                 | Host SDK for embedding apps       | CRITICAL | **Created**                           |
| `docs/UI-RESOURCES.md`               | HTML resource delivery pattern    | CRITICAL | **Created**                           |
| `docs/TROUBLESHOOTING.md`            | Common issues and solutions       | CRITICAL | **Created**                           |
| `docs/TESTING.md`                    | Test patterns and mocking         | CRITICAL | **Created**                           |
| `docs/USE-CASES.md`                  | Real-world application patterns   | CRITICAL | **Created**                           |
| `docs/CLAUDE-DESKTOP-INTEGRATION.md` | Claude Desktop setup              | CRITICAL | **Created**                           |
| `docs/DEPLOYMENT.md`                 | Production deployment guide       | HIGH     | **Created**                           |
| `docs/DEBUGGING.md`                  | DevTools and logging patterns     | HIGH     | **Created**                           |
| `docs/HUMAN-IN-THE-LOOP.md`          | HiTL workflow patterns            | HIGH     | **In SECURITY.md** (see HiTL section) |
| `docs/CHROME-EXTENSION.md`           | Extension transport documentation | HIGH     | Pending                               |
| `docs/COMPONENT-INSTANCES.md`        | Instance state and events         | HIGH     | Pending                               |
| `docs/WEB-COMPONENTS.md`             | Non-React integration             | MEDIUM   | Pending                               |
| `docs/BEST-PRACTICES.md`             | Architectural guidance            | MEDIUM   | Pending                               |

---

## Files to Update

| File              | Required Changes                                                   | Status                                                                                            |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `ARCHITECTURE.md` | Add navigator.modelContext, App Bridge sections, TOC               | **Updated** - TOC added                                                                           |
| `TRANSPORT.md`    | Add TabServerTransport, ExtensionServerTransport, IframeTransports | **Complete** - All 7 transports documented                                                        |
| `SECURITY.md`     | Add HiTL workflows, sandboxing patterns                            | **Updated** - CSRF, XSS, Auth, Threat Model, Prototype Pollution, Timing Attacks, HMAC (Required) |
| `REACT.md`        | Add UIResourceRenderer equivalent                                  | **Updated** - SSR section, origin validation warnings                                             |
| `API.md`          | Add UI Resources, security warnings                                | **Updated** - UI Resources, warnings added                                                        |
| `APP-BRIDGE.md`   | Add authentication context                                         | **Updated** - Full auth section added                                                             |
| `STORE.md`        | Add Safari private mode handling                                   | **Updated** - Safari fallback with detection and localStorage/memory fallback                     |
| `TESTING.md`      | Align coverage with SDK standard                                   | **Updated** - Coverage threshold 95%                                                              |
| `ROADMAP.md`      | Add Phases 9-15 for new features                                   | Already present                                                                                   |

---

## Updated Implementation Roadmap

### Phase 9: Navigator Model Context (CRITICAL)

- 9.1 Implement `navigator.modelContext` polyfill
- 9.2 Add `registerTool()`, `registerResource()`, `registerPrompt()`
- 9.3 Document W3C alignment

### Phase 10: App Bridge / Host SDK (CRITICAL)

- 10.1 Create `@frontmcp/browser/host` package
- 10.2 Implement `createAppHost()` factory
- 10.3 Add IframeParentTransport / IframeChildTransport
- 10.4 Create UIResourceRenderer equivalent

### Phase 11: UI Resource Delivery (CRITICAL)

- 11.1 Implement `text/html;profile=mcp-app` mime type
- 11.2 Add `createUIResource()` helper
- 11.3 Implement `_meta.resourceUri` linking

### Phase 12: Chrome Extension Transport (HIGH)

- 12.1 Implement ExtensionServerTransport
- 12.2 Create extension bridge messaging
- 12.3 Document Claude Desktop/Code integration

### Phase 13: Component Instances & Events (HIGH)

- 13.1 Implement ComponentInstanceRegistry
- 13.2 Add event bus for component events
- 13.3 Implement form state management

### Phase 14: Human-in-the-Loop (HIGH)

- 14.1 Document HiTL philosophy
- 14.2 Implement confirmation dialogs
- 14.3 Add audit logging

### Phase 15: Advanced UI (MEDIUM)

- 15.1 Layout components (Stack, Grid, Container)
- 15.2 Theming system with design tokens
- 15.3 Web Components wrapper

---

## SDK Phase 0: Completed

**Status**: RESOLVED via build-time elimination

The SDK prerequisites for browser support have been completed using build-time module replacement rather than a separate `/core` entry point. This approach:

- **Preserves `declare module` augmentation** for decorator metadata
- **Single SDK package** - no package split needed
- **Build-time code elimination** via esbuild

### Implementation Details

| Component           | Location                                                | Purpose                      |
| ------------------- | ------------------------------------------------------- | ---------------------------- |
| Browser crypto shim | `libs/sdk/src/platform/browser-crypto.ts`               | Web Crypto API compatibility |
| Browser adapter     | `libs/cli/src/commands/build/adapters/browser.ts`       | CLI browser build support    |
| esbuild bundler     | `libs/cli/src/commands/build/bundler.ts`                | Module replacement           |
| Circular dep fix    | `libs/sdk/src/common/decorators/front-mcp.decorator.ts` | Removed unused import        |

### Build Command

```bash
# Build for browser - replaces crypto with Web Crypto at build time
frontmcp build --adapter browser --outDir dist/browser
```

See [ROADMAP.md](./ROADMAP.md) for full Phase 0 details and [BUILD.md](./BUILD.md) for build configuration.

---

## Competitive Positioning Summary

### Key Differentiators to Emphasize

1. **Reactive Store** - "The only browser MCP with built-in reactive state"
2. **Component Registry** - "Enterprise-grade component metadata and discovery"
3. **Store Persistence** - "IndexedDB persistence out of the box"
4. **Security** - "Production-ready security patterns"
5. **Framework Agnostic** - "Works with React, Vue, Svelte, or vanilla JS"

### Weaknesses to Address

| Weakness                                            | Status                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| No `navigator.modelContext` polyfill (W3C standard) | **Documented** - See NAVIGATOR-MODEL-CONTEXT.md |
| No host/embedding SDK (App Bridge)                  | **Documented** - See APP-BRIDGE.md              |
| No HTML resource delivery pattern                   | **Documented** - See UI-RESOURCES.md            |
| No Chrome Extension transport                       | Pending implementation                          |
| No HiTL documentation                               | Partial - See SECURITY.md                       |
| No testing documentation                            | **Created** - See TESTING.md                    |
| No troubleshooting guide                            | **Created** - See TROUBLESHOOTING.md            |
| No Claude Desktop integration                       | **Created** - See CLAUDE-DESKTOP-INTEGRATION.md |
| No real-world use cases                             | **Created** - See USE-CASES.md                  |
| CSRF protection missing                             | **Added** - See SECURITY.md                     |
| XSS prevention patterns                             | **Added** - See SECURITY.md                     |
| Authentication patterns                             | **Added** - See SECURITY.md & APP-BRIDGE.md     |
| Threat model incomplete                             | **Expanded** - See SECURITY.md                  |
