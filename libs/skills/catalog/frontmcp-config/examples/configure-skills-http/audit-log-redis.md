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
// src/server.ts — must be an ES module (`"type": "module"` in package.json,
// or `.mts` extension) so the top-level `await createStorage(...)`
// below is allowed. CommonJS consumers should wrap the bootstrap inside an
// `async function init() { ... }` and await it before constructing the
// FrontMcp class.
import {
  Hs256AuditSigner,
  MemoryAuditStore,
  Rs256AuditSigner,
  setSkillAuditFactory,
  SkillAuditWriter,
  SkillAuditWriterToken,
  StorageAdapterAuditStore,
} from '@frontmcp/adapters/skills';
import { FrontMcp } from '@frontmcp/sdk';
import { createStorage } from '@frontmcp/utils';

import { MainApp } from './main.app';

// Register the audit module record with the SDK. The SDK constructs the
// writer with the positional signature
// `new SkillAuditWriter(store, signer, logger, metrics?, options?)` and
// forwards `subjectMode` from `skillsConfig.audit` into the options bag.
setSkillAuditFactory(() => ({
  SkillAuditWriterToken,
  SkillAuditWriter,
  Hs256AuditSigner,
  MemoryAuditStore,
}));

// createStorage() returns a RootStorage, which is a StorageAdapter. Note this
// is the @frontmcp/utils storage-adapter config shape (`redis.config`), which
// is distinct from the SDK `RedisOptions` (`{ provider, host, port }`) used by
// `@FrontMcp({ redis })` and `skillsConfig.cache.redis` below.
const auditStorage = await createStorage({
  type: 'redis',
  redis: {
    config: { host: process.env.REDIS_HOST!, port: 6379 },
    keyPrefix: 'mcp:skill-audit:',
  },
});

// Constructor signature: new Rs256AuditSigner(privateJwk, keyId).
// Convert a PEM secret to a JWK first if your secret store ships PEMs.
const auditSigner = new Rs256AuditSigner(JSON.parse(process.env.BUNDLE_SIGNING_PRIVATE_JWK!), 'bundle-signing-2026-01');

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
import { createStorage } from '@frontmcp/utils';

const storage = await createStorage({
  type: 'redis',
  redis: { config: { host: process.env.REDIS_HOST!, port: 6379 } },
});
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
