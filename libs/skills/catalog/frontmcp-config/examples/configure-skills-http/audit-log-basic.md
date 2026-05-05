---
name: audit-log-basic
reference: configure-skills-http
level: basic
description: Enable the skill audit log with the in-memory store and HS256 signer for development and tests.
tags: [config, skills, audit, hs256, development]
features:
  - 'Bootstraps the audit subsystem via setSkillAuditFactory(...) before FrontMcp registers'
  - 'MemoryAuditStore keeps records in-process — perfect for tests, lost on restart'
  - 'Hs256AuditSigner refuses to start when NODE_ENV === production with a random key'
  - "subjectMode: 'hash' redacts user identifiers while keeping them correlatable"
---

# Audit Log (Basic, Dev-Mode)

Enable the skill audit log with the in-memory store and HS256 signer for development and tests.

## Code

```typescript
// src/server.ts
import { Hs256AuditSigner, MemoryAuditStore, setSkillAuditFactory, SkillAuditWriter } from '@frontmcp/adapters/skills';
import { FrontMcp } from '@frontmcp/sdk';
import { randomBytes } from '@frontmcp/utils';

import { MainApp } from './main.app';

// Inject the audit module into the SDK once at boot. The SDK does NOT
// statically depend on @frontmcp/adapters/skills — this keeps the static
// dependency graph clean and works in Edge / CSP runtimes.
setSkillAuditFactory(({ signer, store, subjectMode }) => new SkillAuditWriter({ signer, store, subjectMode }));

@FrontMcp({
  info: { name: 'dev-server', version: '1.0.0' },
  apps: [MainApp],
  skillsConfig: {
    enabled: true,
    audit: {
      enabled: true,
      // WARNING: Hs256AuditSigner with a randomBytes() key refuses to fire
      // when NODE_ENV === 'production'. Use Rs256AuditSigner in prod.
      signer: new Hs256AuditSigner({ keyId: 'dev', secret: randomBytes(32) }),
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
- Hs256AuditSigner refuses to start when NODE_ENV === production with a random key
- subjectMode: 'hash' redacts user identifiers while keeping them correlatable

## Related

- See `skill-audit-log` for the full architecture, threat model, and verification recipe
- See `audit-log-redis` for the production-grade variant with persistent storage
