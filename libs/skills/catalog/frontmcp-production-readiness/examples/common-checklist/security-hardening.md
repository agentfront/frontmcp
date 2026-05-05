---
name: security-hardening
reference: common-checklist
level: basic
description: 'Shows how to configure authentication, CORS, input validation, rate limiting, audit logging, and observability counters for a production FrontMCP server.'
tags: [production, redis, session, security, throttle, audit, observability, checklist]
features:
  - "Restricting CORS origins to known domains instead of using `'*'`"
  - 'Configuring rate limiting via the `throttle` option'
  - 'Using Redis for session storage in multi-instance deployments'
  - 'Defining both `inputSchema` and `outputSchema` on tools to prevent data leaks'
  - 'Enabling the tamper-evident skill audit log with RS256 + a persistent store and a CI verifier'
  - 'Wiring an OTel MeterProvider so framework counters (bundle pulls, signature failures, replay rejects) are exported'
  - 'Keeping the auto-injected skill catalog summary inside the 16 KB initialize ceiling'
---

# Security Hardening Configuration

Shows how to configure authentication, CORS, input validation, rate limiting, audit logging, and observability counters for a production FrontMCP server.

## Code

```typescript
// src/main.ts
import { FrontMcp, z } from '@frontmcp/sdk';

import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'secure-server', version: '1.0.0' },
  apps: [MyApp],

  // Authentication: use remote OAuth provider
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: process.env.AUTH_CLIENT_ID!,
  },

  // CORS: restrict to known origins (never use '*' in production)
  cors: {
    origin: ['https://app.example.com', 'https://admin.example.com'],
    credentials: true,
    maxAge: 86400, // Cache preflight for 24 hours
  },

  // Rate limiting: prevent abuse (GuardConfig — see libs/guard)
  throttle: {
    enabled: true,
    global: {
      maxRequests: 100,
      windowMs: 60_000, // 1 minute window
      partitionBy: 'ip', // 'ip' | 'session' | 'global'
    },
    defaultTimeout: { executeMs: 30_000 },
  },

  // Session storage: use Redis (not in-memory) for multi-instance
  redis: {
    provider: 'redis',
    host: process.env.REDIS_HOST ?? 'localhost',
    port: 6379,
  },
})
export default class SecureServer {}
```

```typescript
// src/tools/safe-query.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'safe_query',
  description: 'Query data with validated and sanitized input',
  inputSchema: {
    query: z.string().min(1).max(500).describe('Search query'),
    limit: z.number().int().min(1).max(100).default(10).describe('Max results'),
  },
  outputSchema: {
    results: z.array(z.object({ id: z.string(), title: z.string() })),
    total: z.number(),
  },
})
export class SafeQueryTool extends ToolContext {
  async execute(input: { query: string; limit: number }) {
    // Zod already validated input — safe to use
    // outputSchema prevents accidental data leaks
    return { results: [], total: 0 };
  }
}
```

```typescript
// src/audit-bootstrap.ts — wire the audit log + meter provider before FrontMcp registers
import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

import {
  Rs256AuditSigner,
  setSkillAuditFactory,
  SkillAuditWriter,
  StorageAdapterAuditStore,
} from '@frontmcp/adapters/skills';
import { createStorageAdapter } from '@frontmcp/utils';

// 1. Audit subsystem
setSkillAuditFactory(({ signer, store, subjectMode }) => new SkillAuditWriter({ signer, store, subjectMode }));

export const auditSigner = new Rs256AuditSigner({
  keyId: 'bundle-signing-2026-01',
  privateKeyPem: process.env.BUNDLE_SIGNING_PRIVATE_KEY!,
});

export const auditStore = new StorageAdapterAuditStore(
  await createStorageAdapter({ provider: 'redis', host: process.env.REDIS_HOST!, port: 6379 }),
);

// 2. Meter provider — exports framework counters (bundle pulls, signature failures, ...)
metrics.setGlobalMeterProvider(
  new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT! }),
        exportIntervalMillis: 10_000,
      }),
    ],
  }),
);
```

```typescript
// src/main.ts — wire the audit + meter setup into the FrontMcp config
import './audit-bootstrap';

import { auditSigner, auditStore } from './audit-bootstrap';

@FrontMcp({
  // ... auth/cors/throttle/redis as above ...

  // Keep the user-facing prompt tight so the auto-appended catalog summary
  // stays under the 16 KB initialize ceiling.
  instructions: 'You are a helpful assistant. Use available skills.',

  skillsConfig: {
    enabled: true,
    auth: 'bearer',
    jwt: { issuer: process.env.JWT_ISSUER!, audience: 'skills-api' },
    injectInstructions: 'append',
    audit: {
      enabled: true,
      signer: auditSigner,
      store: auditStore,
      subjectMode: 'hash',
    },
  },
})
export default class HardenedServer {}
```

## What This Demonstrates

- Restricting CORS origins to known domains instead of using `'*'`
- Configuring rate limiting via the `throttle` option
- Using Redis for session storage in multi-instance deployments
- Defining both `inputSchema` and `outputSchema` on tools to prevent data leaks
- Enabling the tamper-evident skill audit log with RS256 + a persistent store and a CI verifier
- Wiring an OTel MeterProvider so framework counters (bundle pulls, signature failures, replay rejects) are exported
- Keeping the auto-injected skill catalog summary inside the 16 KB initialize ceiling

## Related

- See `common-checklist` for the full security, performance, and reliability checklist
- See `skill-audit-log` for the audit chain architecture
- See `configure-skills-http` for the full `skillsConfig` reference
