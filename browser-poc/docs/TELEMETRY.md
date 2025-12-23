# Browser Telemetry & PII Filtering

Capture browser events (interactions, network, errors, logs) with automatic PII filtering before MCP exposure.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Event Categories](#event-categories)
- [PII Filtering](#pii-filtering)
- [Custom Filters](#custom-filters)
- [MCP Resources](#mcp-resources)
- [MCP Notifications](#mcp-notifications)
- [React Integration](#react-integration)
- [Security](#security)
- [Examples](#examples)
- [API Reference](#api-reference)

---

## Overview

The telemetry system captures browser events and exposes them to AI agents via MCP resources and notifications. **PII filtering runs BEFORE any data reaches MCP** - secrets never leave the browser unfiltered.

### Architecture

```
Browser Event → Capture → PII Filter Chain → MCP Notification
                                          → Event Resource (buffer)
```

```
┌─────────────────────────────────────────────────────────────┐
│                    Event Pipeline                            │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Event        │  │ PII Filter  │  │ MCP Exposure        │ │
│  │ Collector    │─▶│ Chain       │─▶│ (Resources +        │ │
│  │ (capture)    │  │ (sanitize)  │  │  Notifications)     │ │
│  └──────────────┘  └─────────────┘  └─────────────────────┘ │
│         │                                     │              │
│         ▼                                     ▼              │
│  createEventCollector()              collector.registerWith()│
└─────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **PII Filtering BEFORE Notification** - Sensitive data filtered before any MCP notification
2. **Grouped Opt-in Categories** - Developers explicitly enable event categories
3. **Plugin-based Filtering** - Extensible filter chain for custom redaction
4. **Dual Exposure** - Events as both resources (pull) and notifications (push)

---

## Quick Start

```typescript
import { createEventCollector, createBuiltInPiiFilter } from '@frontmcp/browser/telemetry';
import { createBrowserMcpServer } from '@frontmcp/browser';

// Create collector with default PII filtering
const collector = createEventCollector({
  categories: {
    interaction: { keyboard: true, click: true },
    network: { fetch: true, xhr: true },
    errors: { console: true, unhandled: true },
    logs: { level: 'warn' },
  },
  filters: [createBuiltInPiiFilter()],
  autoStart: true,
});

// Create server and register collector
const server = createBrowserMcpServer({ name: 'my-app' });
collector.registerWith(server);

// AI can now:
// - Read: events://recent, events://errors, events://network
// - Receive: notifications/events/captured
```

---

## Event Categories

Events are organized into four categories with grouped opt-in configuration.

### Interaction Events

User interactions: keyboard, mouse, hover, click, focus, scroll, input.

```typescript
const collector = createEventCollector({
  categories: {
    interaction: {
      // Keyboard events (keydown, keyup)
      // Values NOT captured by default - only key metadata
      keyboard: true,
      // OR with options:
      keyboard: {
        captureValue: false, // Don't capture actual key values
        captureModifiers: true, // Capture ctrl, alt, shift, meta
        ignoreSelectors: ['[type="password"]'],
      },

      // Mouse click events
      click: true,
      // OR with options:
      click: {
        captureText: true, // Capture clicked element text
        maxTextLength: 100, // Truncate long text
        includeAttributes: ['id', 'class', 'data-testid'],
      },

      // Mouse hover (enter/leave)
      hover: {
        debounce: 200, // Debounce rapid events (ms)
        minDuration: 500, // Minimum hover time to capture (ms)
      },

      // Focus events (focus, blur)
      focus: true,

      // Scroll events
      scroll: {
        debounce: 100, // Debounce scroll events (ms)
        capturePosition: true, // Include scrollX/scrollY
      },

      // Form input events
      // Values filtered through PII chain
      input: {
        captureValue: false, // Don't capture input values
        excludeSelectors: ['[type="password"]', '[data-pii]'],
      },
    },
  },
});
```

**Interaction Event Data:**

```typescript
interface InteractionEvent extends BrowserEvent {
  category: 'interaction';
  type: 'click' | 'keyboard' | 'hover' | 'focus' | 'scroll' | 'input';
  data: {
    target: string; // CSS selector
    tagName: string; // Element tag
    text?: string; // Element text (truncated, filtered)
    attributes?: Record<string, string>;
    details?: {
      // click
      x?: number;
      y?: number;
      button?: number;
      // keyboard
      key?: string;
      code?: string;
      modifiers?: string[];
      // scroll
      scrollX?: number;
      scrollY?: number;
      // input
      value?: string; // Filtered through PII chain
      inputType?: string;
    };
  };
}
```

### Network Events

HTTP requests via fetch/XHR and WebSocket connections.

```typescript
const collector = createEventCollector({
  categories: {
    network: {
      // Fetch API requests
      fetch: true,
      // OR with options:
      fetch: {
        includeHeaders: false, // Don't capture request headers
        includeResponse: true, // Include status and timing
        maxBodySize: 10240, // Max body size (10KB)
      },

      // XMLHttpRequest
      xhr: true,

      // WebSocket connections
      websocket: true,

      // Include request/response bodies
      // Bodies filtered through PII chain
      includeBody: false,

      // URL patterns to exclude (e.g., analytics)
      excludePatterns: [/google-analytics\.com/, /segment\.io/, '/api/health'],
    },
  },
});
```

**Network Event Data:**

```typescript
interface NetworkEvent extends BrowserEvent {
  category: 'network';
  type: 'fetch' | 'xhr' | 'websocket';
  data: {
    url: string; // Filtered
    method: string;
    headers?: Record<string, string>; // Filtered (auth headers redacted)
    body?: string; // Filtered, truncated
    status?: number;
    statusText?: string;
    responseHeaders?: Record<string, string>;
    duration?: number; // Request duration (ms)
    error?: string; // If request failed
  };
}
```

### Error Events

Console errors, unhandled exceptions, and promise rejections.

```typescript
const collector = createEventCollector({
  categories: {
    errors: {
      // console.error calls
      console: true,

      // Unhandled exceptions (window.onerror)
      unhandled: true,

      // Unhandled promise rejections
      unhandledRejection: true,

      // Include stack traces (filtered for file paths)
      includeStack: true,
    },
  },
});
```

**Error Event Data:**

```typescript
interface ErrorEvent extends BrowserEvent {
  category: 'errors';
  type: 'console' | 'unhandled' | 'unhandledRejection';
  data: {
    message: string; // Filtered
    name?: string; // Error name/type
    stack?: string; // Filtered stack trace
    filename?: string; // Source file
    lineno?: number;
    colno?: number;
  };
}
```

### Log Events

Console output (log, warn, error) with level filtering.

```typescript
const collector = createEventCollector({
  categories: {
    logs: {
      // Minimum log level to capture
      level: 'warn', // 'debug' | 'info' | 'warn' | 'error'

      // Custom log categories
      categories: ['api', 'auth', 'performance'],

      // Include console.log/info (default: only warn/error)
      includeInfo: false,
    },
  },
});
```

**Log Event Data:**

```typescript
interface LogEvent extends BrowserEvent {
  category: 'logs';
  type: 'debug' | 'info' | 'warn' | 'error' | 'custom';
  data: {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string; // Filtered
    args?: unknown[]; // Additional arguments (filtered)
    category?: string; // Custom category
  };
}
```

---

## PII Filtering

PII filtering ensures sensitive data never reaches AI agents. Filters run **BEFORE** any MCP notification or resource exposure.

### Filter Chain Architecture

```
Raw Event
    │
    ▼
┌────────────────────────────────────────────────────┐
│              PII Filter Chain                       │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │ Custom      │─▶│ Custom      │─▶│ Built-in   │ │
│  │ Filter 1    │  │ Filter 2    │  │ Filter     │ │
│  │ (priority:  │  │ (priority:  │  │ (priority: │ │
│  │  100)       │  │  50)        │  │  0)        │ │
│  └─────────────┘  └─────────────┘  └────────────┘ │
│                                                     │
│  Secrets NEVER reach beyond this point             │
└───────────────────────┬────────────────────────────┘
                        │
                        ▼
              Filtered Event (or null = dropped)
```

### Built-in PII Patterns

The built-in filter provides patterns for common sensitive data:

```typescript
import { createBuiltInPiiFilter } from '@frontmcp/browser/telemetry';

const filter = createBuiltInPiiFilter({
  patterns: {
    email: true, // user@example.com → [REDACTED:email]
    creditCard: true, // 4111-1111-1111-1111 → [REDACTED:credit-card]
    ssn: true, // 123-45-6789 → [REDACTED:ssn]
    phone: true, // +1-555-123-4567 → [REDACTED:phone]
    apiKey: true, // api_key=abc123... → [REDACTED:api-key]
    bearerToken: true, // Bearer eyJ... → Bearer [REDACTED:token]
    jwt: true, // eyJhbGc... → [REDACTED:jwt]
    ipAddress: true, // 192.168.1.1 → [REDACTED:ip]
    awsKey: true, // AKIAIOSFODNN7... → [REDACTED:aws-key]
    privateKey: true, // -----BEGIN PRIVATE KEY----- → [REDACTED:private-key]
  },
  // Additional custom patterns
  additionalPatterns: [
    {
      name: 'internal-id',
      pattern: /INTERNAL-[A-Z0-9]{8}/g,
      replacement: '[REDACTED:internal-id]',
    },
  ],
  // Fields to never filter (allowlist)
  allowlistFields: ['timestamp', 'category', 'type'],
  // Fields to always filter (blocklist)
  blocklistFields: ['password', 'secret', 'token'],
});
```

### Built-in Pattern Details

| Pattern     | Regex                                                                                                  | Example Match         | Replacement                    |
| ----------- | ------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------ |
| email       | `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g`                                                    | `user@example.com`    | `[REDACTED:email]`             |
| creditCard  | `/\b(?:\d{4}[-\s]?){3}\d{4}\b/g`                                                                       | `4111-1111-1111-1111` | `[REDACTED:credit-card]`       |
| ssn         | `/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g`                                                                   | `123-45-6789`         | `[REDACTED:ssn]`               |
| phone       | `/\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g`                                  | `+1-555-123-4567`     | `[REDACTED:phone]`             |
| bearerToken | `/Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/gi`                                       | `Bearer eyJ...`       | `Bearer [REDACTED:token]`      |
| apiKey      | `/(?:api[_-]?key\|apikey\|secret[_-]?key)[=:]\s*['"]?([A-Za-z0-9\-_]{16,})['"]?/gi`                    | `api_key=abc123...`   | `api_key=[REDACTED:api-key]`   |
| jwt         | `/eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/g`                                           | `eyJhbGc...`          | `[REDACTED:jwt]`               |
| ipv4        | `/\b(?:(?:25[0-5]\|2[0-4][0-9]\|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]\|2[0-4][0-9]\|[01]?[0-9][0-9]?)\b/g` | `192.168.1.1`         | `[REDACTED:ip]`                |
| awsKey      | `/(?:AKIA\|ABIA\|ACCA\|ASIA)[A-Z0-9]{16}/g`                                                            | `AKIAIOSFODNN7...`    | `[REDACTED:aws-key]`           |
| privateKey  | `/-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END.../g`                                     | PEM key               | `[REDACTED:private-key]`       |
| urlPassword | `/:\/\/([^:]+):([^@]+)@/g`                                                                             | `://user:pass@`       | `://user:[REDACTED:password]@` |

---

## Custom Filters

Create domain-specific PII filters for your application.

### PiiFilterPlugin Interface

```typescript
interface PiiFilterPlugin {
  /**
   * Unique plugin name
   */
  name: string;

  /**
   * Priority (higher = runs first)
   * @default 0
   */
  priority?: number;

  /**
   * Regex patterns for auto-redaction
   */
  patterns?: PiiPattern[];

  /**
   * Custom filter function
   * Return filtered event, or null to drop entirely
   */
  filter?(event: BrowserEvent, context: FilterContext): BrowserEvent | null;

  /**
   * Optional initialization
   */
  initialize?(): Promise<void>;

  /**
   * Optional cleanup
   */
  destroy?(): void;
}

interface PiiPattern {
  name: string;
  pattern: RegExp;
  fields?: string[] | '*'; // Fields to apply to (* = all)
  replacement?: string | ((match: string, ctx: FilterContext) => string);
}

interface FilterContext {
  category: EventCategory;
  originalEvent: BrowserEvent;
  session?: { sessionId: string; userId?: string };
  redactionCount: number;
  markRedacted(field: string, patternName: string): void;
  getRedactionSummary(): { count: number; fields: Array<{ path: string; pattern: string }> };
}
```

### Creating Custom Filters

```typescript
import { createPiiFilterPlugin } from '@frontmcp/browser/telemetry';

// Healthcare-specific PII filter
const healthcareFilter = createPiiFilterPlugin({
  name: 'healthcare-pii',
  priority: 100, // Run before built-in
  patterns: [
    {
      name: 'mrn',
      pattern: /MRN[:\s]*\d{6,10}/gi,
      replacement: '[REDACTED:mrn]',
    },
    {
      name: 'npi',
      pattern: /NPI[:\s]*\d{10}/gi,
      replacement: '[REDACTED:npi]',
    },
    {
      name: 'dob',
      pattern: /\b(?:DOB|birth[_-]?date)[:\s]*\d{1,2}\/\d{1,2}\/\d{2,4}/gi,
      replacement: '[REDACTED:dob]',
    },
  ],
  filter(event, context) {
    // Drop events from patient-related URLs entirely
    if (event.category === 'network') {
      const url = (event.data as any).url;
      if (url?.includes('/patient/') || url?.includes('/medical-records/')) {
        return null; // Drop event
      }
    }
    return event;
  },
});

// Financial services filter
const financeFilter = createPiiFilterPlugin({
  name: 'finance-pii',
  priority: 100,
  patterns: [
    {
      name: 'account-number',
      pattern: /\b\d{9,18}\b/g,
      fields: ['body', 'message'], // Only apply to these fields
      replacement: '[REDACTED:account]',
    },
    {
      name: 'routing-number',
      pattern: /\b\d{9}\b/g,
      fields: ['body'],
      replacement: '[REDACTED:routing]',
    },
  ],
});

// Use custom filters
const collector = createEventCollector({
  categories: {
    /* ... */
  },
  filters: [
    healthcareFilter,
    financeFilter,
    createBuiltInPiiFilter(), // Built-in runs last
  ],
});
```

### Filter Priority Order

Filters execute in priority order (highest first):

```typescript
const collector = createEventCollector({
  filters: [
    createPiiFilterPlugin({ name: 'custom-1', priority: 100 }), // Runs 1st
    createPiiFilterPlugin({ name: 'custom-2', priority: 50 }), // Runs 2nd
    createBuiltInPiiFilter(), // Runs 3rd (priority: 0)
  ],
});
```

---

## MCP Resources

Telemetry exposes events via MCP resources for AI agent access.

### Available Resources

| Resource                       | Description                           |
| ------------------------------ | ------------------------------------- |
| `events://recent`              | Recent events buffer (all categories) |
| `events://errors`              | Error events only                     |
| `events://network`             | Network requests                      |
| `events://interactions`        | User interactions                     |
| `events://logs`                | Console logs                          |
| `events://stats`               | Collector statistics                  |
| `events://category/{category}` | Events filtered by category           |

### Resource Schemas

#### events://recent

```typescript
interface RecentEventsResource {
  events: BrowserEvent[];
  metadata: {
    count: number;
    oldestTimestamp: number;
    newestTimestamp: number;
    categories: EventCategory[];
  };
}
```

#### events://errors

```typescript
interface ErrorEventsResource {
  errors: ErrorEvent[];
  metadata: {
    count: number;
    byType: Record<'console' | 'unhandled' | 'unhandledRejection', number>;
    oldestTimestamp: number;
    newestTimestamp: number;
  };
}
```

#### events://network

```typescript
interface NetworkEventsResource {
  requests: NetworkEvent[];
  metadata: {
    count: number;
    byStatus: Record<number, number>; // { 200: 45, 404: 2, 500: 1 }
    byMethod: Record<string, number>; // { GET: 30, POST: 15 }
    oldestTimestamp: number;
    newestTimestamp: number;
  };
}
```

#### events://stats

```typescript
interface TelemetryStatsResource {
  collector: {
    captured: number;
    filtered: number;
    buffered: number;
    byCategory: Record<EventCategory, number>;
    startedAt: number | null;
    activeDuration: number;
  };
  pipeline: {
    processed: number;
    filtered: number;
    dropped: number;
    filterTiming: Record<string, number>;
  };
  buffer: {
    size: number;
    maxSize: number;
    utilizationPercent: number;
  };
  filters: Array<{
    name: string;
    priority: number;
    eventsProcessed: number;
    eventsFiltered: number;
    eventsDropped: number;
    avgProcessingTimeMs: number;
  }>;
}
```

### AI Agent Usage

```typescript
// AI agent reads events
const recentEvents = await mcp.readResource('events://recent');
const errors = await mcp.readResource('events://errors');
const networkRequests = await mcp.readResource('events://network');

// Check telemetry health
const stats = await mcp.readResource('events://stats');
console.log(`Buffer: ${stats.buffer.utilizationPercent}% full`);
```

---

## MCP Notifications

Real-time event notifications push to AI agents.

### notifications/events/captured

```typescript
interface EventCapturedNotification {
  method: 'notifications/events/captured';
  params: {
    event: BrowserEvent;
    category: EventCategory;
    significance: 'low' | 'medium' | 'high';
  };
}
```

### Significance Levels

| Level    | Triggers                                                         |
| -------- | ---------------------------------------------------------------- |
| `high`   | Errors, unhandled exceptions, failed network requests (4xx, 5xx) |
| `medium` | Warnings, slow network requests (>3s), form submissions          |
| `low`    | Regular interactions, successful requests, info logs             |

### Notification Configuration

```typescript
const collector = createEventCollector({
  categories: {
    /* ... */
  },
  notifications: {
    // Enable real-time notifications
    enabled: true,

    // Minimum significance to notify
    minSignificance: 'medium', // Only medium and high

    // Categories to send notifications for
    categories: ['errors', 'network'],

    // Debounce rapid notifications (ms)
    debounce: 100,

    // Rate limit notifications
    rateLimit: 10, // Max 10 per second

    // Batch notifications
    batching: {
      enabled: true,
      maxBatchSize: 5,
      maxWaitMs: 500,
    },
  },
});
```

---

## React Integration

React hooks for telemetry access.

### TelemetryProvider

```tsx
import { TelemetryProvider } from '@frontmcp/browser/telemetry/react';

function App() {
  return (
    <TelemetryProvider
      categories={{
        interaction: { click: true },
        network: { fetch: true },
        errors: { console: true, unhandled: true },
        logs: { level: 'warn' },
      }}
      autoStart={true}
    >
      <MyApp />
    </TelemetryProvider>
  );
}
```

### useEventCollector

Access the collector instance.

```tsx
import { useEventCollector } from '@frontmcp/browser/telemetry/react';

function DebugControls() {
  const collector = useEventCollector();

  return (
    <div>
      <p>Active: {collector.isActive ? 'Yes' : 'No'}</p>
      <button onClick={() => collector.start()}>Start</button>
      <button onClick={() => collector.stop()}>Stop</button>
      <button onClick={() => collector.clear()}>Clear</button>
    </div>
  );
}
```

### useEvents

Subscribe to events with optional filtering.

```tsx
import { useEvents } from '@frontmcp/browser/telemetry/react';

function ErrorPanel() {
  const errors = useEvents('errors', { limit: 10 });

  return (
    <div>
      <h3>Recent Errors ({errors.length})</h3>
      {errors.map((e) => (
        <div key={e.id} className="error">
          <span>
            {e.data.name}: {e.data.message}
          </span>
          {e.data.stack && <pre>{e.data.stack}</pre>}
        </div>
      ))}
    </div>
  );
}

function NetworkMonitor() {
  // Only show failed requests
  const failedRequests = useEvents('network', {
    limit: 20,
    filter: (e) => (e.data as any).status >= 400,
  });

  return (
    <div>
      <h3>Failed Requests ({failedRequests.length})</h3>
      {failedRequests.map((e) => (
        <div key={e.id}>
          {e.data.method} {e.data.url} - {e.data.status}
        </div>
      ))}
    </div>
  );
}
```

### useTelemetryStats

Access collector statistics.

```tsx
import { useTelemetryStats } from '@frontmcp/browser/telemetry/react';

function TelemetryHealth() {
  const stats = useTelemetryStats();

  return (
    <div>
      <p>Events captured: {stats.collector.captured}</p>
      <p>Events filtered: {stats.collector.filtered}</p>
      <p>Buffer: {stats.buffer.utilizationPercent}% full</p>
    </div>
  );
}
```

---

## Security

### Fields Never Captured

These fields are NEVER captured regardless of configuration:

| Selector/Pattern              | Reason                          |
| ----------------------------- | ------------------------------- |
| `[type="password"]`           | Password inputs                 |
| `[data-pii="true"]`           | Developer-marked PII            |
| `Authorization` header values | Auth tokens (auto-redacted)     |
| `Cookie` header values        | Session cookies (auto-redacted) |
| `Set-Cookie` response headers | Session cookies                 |

### Rate Limiting

Events are rate-limited to prevent DoS and buffer overflow:

| Event Type       | Default Limit |
| ---------------- | ------------- |
| Keyboard         | 100/sec       |
| Click            | 50/sec        |
| Mouse move/hover | 20/sec        |
| Scroll           | 10/sec        |
| Network          | 100/sec       |
| Errors           | 50/sec        |
| Logs             | 100/sec       |

```typescript
const collector = createEventCollector({
  categories: {
    /* ... */
  },
  sampling: {
    rate: 1, // Sample rate (0-1)
    threshold: 100, // Events/sec before sampling kicks in
    categories: ['interaction'], // Only sample interactions
  },
});
```

### Audit Logging

Track filter actions for compliance:

```typescript
const collector = createEventCollector({
  categories: {
    /* ... */
  },
  audit: {
    enabled: true,
    destination: 'callback',
    onAudit: (entry) => {
      // entry: { timestamp, eventId, action, filter?, redactions? }
      console.log(`[AUDIT] ${entry.action}: ${entry.eventId}`);
      sendToComplianceSystem(entry);
    },
  },
});
```

### Buffer Configuration

```typescript
const collector = createEventCollector({
  categories: {
    /* ... */
  },
  buffer: {
    maxSize: 1000, // Maximum events in buffer
    maxAge: 300000, // Max age: 5 minutes
    categoryLimits: {
      interaction: 500,
      network: 300,
      errors: 100,
      logs: 100,
    },
  },
});
```

---

## Examples

### Debug Panel

```tsx
import { TelemetryProvider, useEvents, useEventCollector, useTelemetryStats } from '@frontmcp/browser/telemetry/react';

function DebugPanel() {
  const collector = useEventCollector();
  const stats = useTelemetryStats();
  const errors = useEvents('errors', { limit: 5 });
  const networkErrors = useEvents('network', {
    limit: 5,
    filter: (e) => (e.data as any).status >= 400,
  });

  return (
    <div className="debug-panel">
      <header>
        <h2>Debug Panel</h2>
        <span>Buffer: {stats.buffer.utilizationPercent}%</span>
        <button onClick={() => collector.clear()}>Clear</button>
      </header>

      <section>
        <h3>Errors ({errors.length})</h3>
        {errors.map((e) => (
          <div key={e.id} className="error-item">
            <strong>{e.data.name}</strong>: {e.data.message}
          </div>
        ))}
      </section>

      <section>
        <h3>Failed Requests ({networkErrors.length})</h3>
        {networkErrors.map((e) => (
          <div key={e.id} className="request-item failed">
            {e.data.method} {e.data.url} - {e.data.status}
          </div>
        ))}
      </section>
    </div>
  );
}

function App() {
  return (
    <TelemetryProvider
      categories={{
        errors: { console: true, unhandled: true },
        network: { fetch: true },
      }}
      autoStart={process.env.NODE_ENV === 'development'}
    >
      <MyApp />
      {process.env.NODE_ENV === 'development' && <DebugPanel />}
    </TelemetryProvider>
  );
}
```

### Healthcare Application

```typescript
import { createEventCollector, createPiiFilterPlugin, createBuiltInPiiFilter } from '@frontmcp/browser/telemetry';

// HIPAA-compliant PII filter
const hipaaFilter = createPiiFilterPlugin({
  name: 'hipaa-compliance',
  priority: 100,
  patterns: [
    { name: 'mrn', pattern: /MRN[:\s]*\d{6,10}/gi },
    { name: 'npi', pattern: /NPI[:\s]*\d{10}/gi },
    { name: 'dea', pattern: /DEA[:\s]*[A-Z]\d{7}/gi },
    { name: 'dob', pattern: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  ],
  filter(event, context) {
    // Drop all events from PHI-related endpoints
    if (event.category === 'network') {
      const url = (event.data as any).url || '';
      if (url.includes('/patient/') || url.includes('/medical-records/') || url.includes('/ehr/')) {
        return null; // Drop entirely
      }
    }
    return event;
  },
});

const collector = createEventCollector({
  categories: {
    network: {
      fetch: true,
      includeBody: false, // Never capture request bodies
      excludePatterns: ['/api/patient/', '/api/records/'],
    },
    errors: { console: true, unhandled: true },
    logs: { level: 'error' }, // Only errors
  },
  filters: [hipaaFilter, createBuiltInPiiFilter()],
  audit: {
    enabled: true,
    onAudit: sendToComplianceAuditLog,
  },
});
```

### E-commerce Application

```typescript
import { createEventCollector, createPiiFilterPlugin, createBuiltInPiiFilter } from '@frontmcp/browser/telemetry';

// PCI-DSS compliant filter
const pciFilter = createPiiFilterPlugin({
  name: 'pci-compliance',
  priority: 100,
  patterns: [
    { name: 'cvv', pattern: /\b\d{3,4}\b/g, fields: ['body'] },
    { name: 'expiry', pattern: /\b\d{2}\/\d{2,4}\b/g },
  ],
  filter(event, context) {
    // Drop events from payment-related URLs
    if (event.category === 'network') {
      const url = (event.data as any).url || '';
      if (url.includes('/checkout/') || url.includes('/payment/')) {
        return null;
      }
    }
    return event;
  },
});

const collector = createEventCollector({
  categories: {
    interaction: {
      click: true, // Track button clicks for analytics
      input: {
        captureValue: false, // Never capture input values
        excludeSelectors: ['[name="card-number"]', '[name="cvv"]', '[name="expiry"]', '[autocomplete*="cc-"]'],
      },
    },
    network: {
      fetch: true,
      includeBody: false,
      excludePatterns: ['/api/payment/', '/api/checkout/'],
    },
    errors: { console: true, unhandled: true },
  },
  filters: [pciFilter, createBuiltInPiiFilter()],
});
```

---

## API Reference

### createEventCollector

```typescript
function createEventCollector(options: EventCollectorOptions): EventCollector;

interface EventCollectorOptions {
  categories: EventCategoryConfig;
  filters?: PiiFilterPlugin[];
  buffer?: EventBufferConfig;
  notifications?: EventNotificationConfig;
  sampling?: EventSamplingConfig;
  audit?: TelemetryAuditConfig;
  autoStart?: boolean;
}
```

### EventCollector

```typescript
interface EventCollector {
  // Lifecycle
  start(): void;
  stop(): void;
  readonly isActive: boolean;
  destroy(): void;

  // Event access
  getRecentEvents(options?: GetEventsOptions): BrowserEvent[];
  getEventsByCategory(category: EventCategory): BrowserEvent[];
  getErrors(): ErrorEvent[];
  getNetworkEvents(): NetworkEvent[];

  // Subscriptions
  subscribe(callback: EventSubscriber): () => void;
  subscribeCategory(category: EventCategory, callback: EventSubscriber): () => void;

  // Filters
  addFilter(filter: PiiFilterPlugin): void;
  removeFilter(name: string): boolean;

  // Utilities
  clear(): void;
  getStats(): CollectorStats;

  // MCP integration
  registerWith(server: BrowserMcpServer): void;
}
```

### createBuiltInPiiFilter

```typescript
function createBuiltInPiiFilter(options?: BuiltInPiiFilterOptions): PiiFilterPlugin;

interface BuiltInPiiFilterOptions {
  patterns?: {
    email?: boolean;
    creditCard?: boolean;
    ssn?: boolean;
    phone?: boolean;
    apiKey?: boolean;
    bearerToken?: boolean;
    ipAddress?: boolean;
    jwt?: boolean;
    awsKey?: boolean;
    privateKey?: boolean;
  };
  additionalPatterns?: PiiPattern[];
  allowlistFields?: string[];
  blocklistFields?: string[];
}
```

### createPiiFilterPlugin

```typescript
function createPiiFilterPlugin(options: PiiFilterPluginOptions): PiiFilterPlugin;

interface PiiFilterPluginOptions {
  name: string;
  priority?: number;
  patterns?: PiiPattern[];
  filter?: (event: BrowserEvent, context: FilterContext) => BrowserEvent | null;
  initialize?: () => Promise<void>;
  destroy?: () => void;
}
```

### BrowserEvent

```typescript
type EventCategory = 'interaction' | 'network' | 'errors' | 'logs';

interface BrowserEvent {
  id: string;
  category: EventCategory;
  type: string;
  timestamp: number;
  data: unknown;
  _redacted?: {
    count: number;
    fields: string[];
  };
}
```

---

## See Also

- [STORE.md](./STORE.md) - Valtio store with MCP integration
- [SECURITY.md](./SECURITY.md) - Security patterns and authorization
- [API.md](./API.md) - Full API reference
- [SCHEMA-STORE.md](./SCHEMA-STORE.md) - Schema-driven stores with actions
