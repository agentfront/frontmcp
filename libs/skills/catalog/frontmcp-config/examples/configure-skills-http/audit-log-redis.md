---
name: audit-log-redis
reference: configure-skills-http
level: advanced
description: Production-grade audit log with the Redis-backed StorageAdapterAuditStore and the RS256 bundle-signing key.
tags: [config, skills, audit, rs256, redis, production]
features:
  - 'StorageAdapterAuditStore persists records to Redis via the standard storage adapter'
  - 'Rs256AuditSigner reuses the bundle-signing keypair for forensic-friendly signatures'
  - 'Single-writer constraint: only one pod should write the chain in v1.2.0'
  - 'verifyChain(records, trustedKeys, defaultAuditSignatureVerifier) detects tampering'
---

# Audit Log (Production, Redis + RS256)

Production-grade audit log with the Redis-backed StorageAdapterAuditStore and the RS256 bundle-signing key.

## Code

```typescript
// src/server.ts
import {
  Rs256AuditSigner,
  setSkillAuditFactory,
  SkillAuditWriter,
  StorageAdapterAuditStore,
} from '@frontmcp/adapters/skills';
import { FrontMcp } from '@frontmcp/sdk';
import { createStorageAdapter } from '@frontmcp/utils';

import { MainApp } from './main.app';

setSkillAuditFactory(({ signer, store, subjectMode }) => new SkillAuditWriter({ signer, store, subjectMode }));

const auditStorage = await createStorageAdapter({
  provider: 'redis',
  host: process.env.REDIS_HOST!,
  port: 6379,
  keyPrefix: 'mcp:skill-audit:',
});

const auditSigner = new Rs256AuditSigner({
  keyId: 'bundle-signing-2026-01',
  privateKeyPem: process.env.BUNDLE_SIGNING_PRIVATE_KEY!,
});

@FrontMcp({
  info: { name: 'prod-server', version: '1.0.0' },
  apps: [MainApp],
  redis: { provider: 'redis', host: process.env.REDIS_HOST!, port: 6379 },
  skillsConfig: {
    enabled: true,
    auth: 'bearer',
    jwt: { issuer: process.env.JWT_ISSUER!, audience: 'skills-api' },
    cache: {
      enabled: true,
      redis: { provider: 'redis', host: process.env.REDIS_HOST!, port: 6379 },
      ttlMs: 60_000,
    },
    audit: {
      enabled: true,
      signer: auditSigner,
      store: new StorageAdapterAuditStore(auditStorage),
      subjectMode: 'hash',
    },
  },
})
export default class ProductionServer {}
```

```typescript
// scripts/verify-audit-chain.ts — run in CI
import { defaultAuditSignatureVerifier, StorageAdapterAuditStore, verifyChain } from '@frontmcp/adapters/skills';
import { createStorageAdapter } from '@frontmcp/utils';

const storage = await createStorageAdapter({ provider: 'redis', host: process.env.REDIS_HOST!, port: 6379 });
const store = new StorageAdapterAuditStore(storage);
const records = await store.iterate();

const trustedKeys = {
  'bundle-signing-2026-01': process.env.BUNDLE_SIGNING_PUBLIC_KEY!,
};

const result = verifyChain(records, trustedKeys, defaultAuditSignatureVerifier);
if (!result.ok) {
  console.error('Audit chain broken at', result.breakAt, result.reason);
  process.exit(1);
}
```

## What This Demonstrates

- StorageAdapterAuditStore persists records to Redis via the standard storage adapter
- Rs256AuditSigner reuses the bundle-signing keypair for forensic-friendly signatures
- Single-writer constraint: only one pod should write the chain in v1.2.0
- verifyChain(records, trustedKeys, defaultAuditSignatureVerifier) detects tampering

## Related

- See `skill-audit-log` for the architecture, threat model, and custom signer / custom store recipes
- See `audit-log-basic` for the dev-mode variant
