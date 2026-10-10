---
name: audit-log-basic
reference: configure-skills-http
level: basic
description: Enable the skill audit log with the in-memory store and HS256 signer for development and tests.
tags: [config, skills, audit, hs256, development]
features:
  - 'Bootstraps the audit subsystem via setSkillAuditFactory(...) before FrontMcp registers'
  - 'MemoryAuditStore keeps records in-process — perfect for tests, lost on restart'
  - 'A random-key Hs256AuditSigner cannot verify records after a restart: use Rs256AuditSigner in production'
  - "subjectMode: 'hash' redacts user identifiers while keeping them correlatable (keyed from the signer's secret)"
---

# Audit Log (Basic, Dev-Mode)

Enable the skill audit log with the in-memory store and HS256 signer for development and tests.

## Code

```typescript
// src/server.ts
import * as auditModule from '@frontmcp/adapters/skills';
import { Hs256AuditSigner, MemoryAuditStore } from '@frontmcp/adapters/skills';
import { FrontMcp, setSkillAuditFactory } from '@frontmcp/sdk';
import { randomBytes } from '@frontmcp/utils';

import { MainApp } from './main.app';

// Register the audit module with the SDK at boot (not needed when
// @frontmcp/plugin-skilled-openapi is installed: the plugin registers it). The SDK
// constructs the writer as `new SkillAuditWriter(store, signer, logger, metrics, options)`,
// with `metrics`, `subjectMode` and `subjectHashSecret` taken from `skillsConfig.audit`.
// The SDK does NOT statically depend on @frontmcp/adapters/skills — this keeps the
// static dependency graph clean and works in Edge / CSP runtimes.
setSkillAuditFactory(() => auditModule);

@FrontMcp({
  info: { name: 'dev-server', version: '1.0.0' },
  apps: [MainApp],
  skillsConfig: {
    enabled: true,
    audit: {
      enabled: true,
      // A random key cannot verify records after a restart. Use Rs256AuditSigner in production.
      // Constructor signature: new Hs256AuditSigner(secret, keyId)
      signer: new Hs256AuditSigner(randomBytes(32), 'dev'),
      store: new MemoryAuditStore(),
      subjectMode: 'hash',
    },
  },
})
export default class DevServer {}
```

## What This Demonstrates

- Bootstraps the audit subsystem via setSkillAuditFactory(...) before FrontMcp registers
- MemoryAuditStore keeps records in-process — perfect for tests, lost on restart
- A random-key Hs256AuditSigner cannot verify records after a restart: use Rs256AuditSigner in production
- subjectMode: 'hash' redacts user identifiers while keeping them correlatable (keyed from the signer's secret)
- The in-memory store is development-only: with audit enabled in production, the server refuses to start without a `store`

## Related

- See `skill-audit-log` for the full architecture, threat model, and verification recipe
- See `audit-log-redis` for the production-grade variant with persistent storage
