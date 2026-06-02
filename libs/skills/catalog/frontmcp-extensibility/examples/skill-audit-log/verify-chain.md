---
name: verify-chain
reference: skill-audit-log
level: intermediate
description: Verify a stored chain offline using verifyChain and the bundle-signing key registry.
tags: [extensibility, audit, verification, chain, rs256]
features:
  - 'verifyChain returns { ok, breakAt?, reason? } and exits with the first detected break'
  - 'defaultAuditSignatureVerifier dispatches on record.signatureAlg (HS256 or RS256)'
  - 'Trusted-keys registry maps signatureKeyId → public key PEM'
  - 'iterate() reads the chain in order from any SkillAuditStore implementation'
---

# Verify Audit Chain

Verify a stored chain offline using verifyChain and the bundle-signing key registry.

## Code

```typescript
// scripts/verify-audit-chain.ts
import { defaultAuditSignatureVerifier, StorageAdapterAuditStore, verifyChain } from '@frontmcp/adapters/skills';
import { createStorage } from '@frontmcp/utils';

async function main() {
  // createStorage() returns a RootStorage, which is a StorageAdapter.
  const storage = await createStorage({
    type: 'redis',
    redis: {
      config: { host: process.env.REDIS_HOST!, port: 6379 },
      keyPrefix: 'mcp:skill-audit:',
    },
  });

  const store = new StorageAdapterAuditStore(storage);
  const records = await store.iterate();

  const trustedKeys: Record<string, string> = {
    // Map every keyId you have ever rotated through, not just the current one.
    'bundle-signing-2026-01': process.env.BUNDLE_SIGNING_PUBLIC_KEY_2026_01!,
    'bundle-signing-2025-12': process.env.BUNDLE_SIGNING_PUBLIC_KEY_2025_12!,
  };

  const result = verifyChain(records, trustedKeys, defaultAuditSignatureVerifier);

  if (!result.ok) {
    console.error(`Chain broken at sequence ${result.breakAt}: ${result.reason}`);
    process.exit(1);
  }

  console.log(`Verified ${records.length} records, chain intact.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## What This Demonstrates

- verifyChain returns { ok, breakAt?, reason? } and exits with the first detected break
- defaultAuditSignatureVerifier dispatches on record.signatureAlg (HS256 or RS256)
- Trusted-keys registry maps signatureKeyId → public key PEM
- iterate() reads the chain in order from any SkillAuditStore implementation

## Related

- See `skill-audit-log` for architecture and threat model
- See `custom-store` for streaming records to S3
