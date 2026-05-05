---
name: skill-audit-log
description: Tamper-evident, hash-chained audit log for skill action executions — pluggable signer, pluggable store, offline verification.
tags: [extensibility, audit, skills, tamper-evident, signature, chain]
---

# Skill Audit Log

The `@frontmcp/adapters/skills` module provides a tamper-evident, hash-chained audit log for skill action executions. Every authority pass / authority fail / HTTP success / HTTP failure phase emitted by `execute-action.tool.ts` is captured, signed, and chained so any later mutation breaks signature verification.

## Architecture

```text
ToolContext.execute()
  └── audit phase emitted (auth pass | auth fail | http ok | http fail)
       └── SkillAuditWriter.append({ phase, skillId, actionId, subject, result, ... })
            ├── compute prevHash from the last record
            ├── assemble SkillAuditRecord { sequence, prevHash, ...payload }
            ├── SkillAuditSigner.sign(record)  → { signature, signatureKeyId, signatureAlg }
            └── SkillAuditStore.append(signedRecord)
```

Each `SkillAuditRecord` carries:

| Field            | Description                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| `sequence`       | Strictly increasing position in the chain                               |
| `prevHash`       | SHA-256 hash of the previous record (or `null` at sequence 0)           |
| `signature`      | Base64url signature over the canonical record bytes                     |
| `signatureKeyId` | The signer key identifier — used by verifiers to look up the public key |
| `signatureAlg`   | `'HS256'` or `'RS256'`                                                  |
| `phase`          | `'authority_pass' \| 'authority_fail' \| 'http_ok' \| 'http_fail'`      |
| `skillId`        | The skill that owns the action                                          |
| `actionId`       | The action that was executed                                            |
| `subject`        | Authenticated principal — redacted per `subjectMode`                    |
| `bundleVersion`  | The bundle version active at the time of the call                       |

## Configuration

Wire the audit subsystem through `skillsConfig.audit` on `@FrontMcp`:

```typescript
import { Hs256AuditSigner, MemoryAuditStore, setSkillAuditFactory, SkillAuditWriter } from '@frontmcp/adapters/skills';

setSkillAuditFactory(({ signer, store, subjectMode }) => new SkillAuditWriter({ signer, store, subjectMode }));

@FrontMcp({
  info: { name: 'svr', version: '1.0.0' },
  apps: [MainApp],
  skillsConfig: {
    enabled: true,
    audit: {
      enabled: true,
      signer: new Hs256AuditSigner({ keyId: 'dev', secret }),
      store: new MemoryAuditStore(),
      subjectMode: 'hash', // 'plain' | 'hash' | 'omit'
    },
  },
})
class Server {}
```

`setSkillAuditFactory(...)` injects the audit module into the SDK at boot. The SDK does **not** statically depend on `@frontmcp/adapters/skills` — this keeps the static dependency graph clean and works in Edge / CSP runtimes.

| `skillsConfig.audit` field | Type                          | Default   |
| -------------------------- | ----------------------------- | --------- |
| `enabled`                  | `boolean`                     | `false`   |
| `signer`                   | `SkillAuditSigner`            | dev HS256 |
| `store`                    | `SkillAuditStore`             | memory    |
| `subjectMode`              | `'plain' \| 'hash' \| 'omit'` | `'hash'`  |
| `headAnchorIntervalMs`     | `number \| undefined`         | unset     |

## Built-in Signers

| Signer             | Key                        | When to use                                                                          |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------ |
| `Hs256AuditSigner` | Symmetric HMAC-SHA-256     | Dev / tests only. Refuses to fire when `NODE_ENV === 'production'` with a random key |
| `Rs256AuditSigner` | Asymmetric RSA-PSS / RS256 | **Production.** Reuse the bundle-signing keypair so the same trust root covers both  |

```typescript
import { Rs256AuditSigner } from '@frontmcp/adapters/skills';

const signer = new Rs256AuditSigner({
  keyId: 'bundle-signing-2026-01',
  privateKeyPem: process.env.BUNDLE_SIGNING_PRIVATE_KEY!,
});
```

`Rs256AuditSigner` uses `rsaSignBase64Url` from `@frontmcp/utils` under the hood.

## Built-in Stores

| Store                      | Persistence                                               | When to use      |
| -------------------------- | --------------------------------------------------------- | ---------------- |
| `MemoryAuditStore`         | In-process; lost on restart                               | Tests, local dev |
| `StorageAdapterAuditStore` | Any `@frontmcp/utils` storage adapter (Redis, KV, SQLite) | Production       |

```typescript
import { StorageAdapterAuditStore } from '@frontmcp/adapters/skills';
import { createStorageAdapter } from '@frontmcp/utils';

const storage = await createStorageAdapter({ provider: 'redis', host: 'localhost', port: 6379 });
const store = new StorageAdapterAuditStore(storage);
```

A custom store implements:

```typescript
interface SkillAuditStore {
  append(record: SkillAuditRecord): Promise<void>;
  tail(limit: number): Promise<SkillAuditRecord[]>;
  iterate(after?: number): Promise<SkillAuditRecord[]>;
}
```

See [`custom-store`](../examples/skill-audit-log/custom-store.md) for an S3-backed implementation.

## Verifying the Chain

```typescript
import { defaultAuditSignatureVerifier, verifyChain } from '@frontmcp/adapters/skills';

const records = await store.iterate();
const trustedKeys = {
  'bundle-signing-2026-01': PUBLIC_KEY_PEM,
};

const result = verifyChain(records, trustedKeys, defaultAuditSignatureVerifier);

if (!result.ok) {
  console.error('Chain broken at sequence', result.breakAt, '—', result.reason);
}
```

`verifyChain` returns `{ ok: true } | { ok: false; breakAt: number; reason: string }`. `defaultAuditSignatureVerifier` understands HS256 and RS256 records and dispatches based on `record.signatureAlg`.

## DI Integration

`SkillAuditWriterToken` is the DI token for the active writer. Plugins that need to emit additional audit records (e.g., a custom authority gate) can resolve it:

```typescript
import { SkillAuditWriterToken } from '@frontmcp/adapters/skills';

class MyPlugin extends DynamicPlugin {
  @ToolHook.Will('execute')
  willExecute(flowCtx: FlowCtxOf<'tools:call-tool'>): void {
    const writer = flowCtx.scope.tryGet(SkillAuditWriterToken);
    writer?.append({ phase: 'authority_pass' /* ... */ });
  }
}
```

Plugins should always go through `SkillAuditWriterToken` rather than rolling their own audit log so the chain stays unified.

## Threat Model

What the audit log catches:

- **Record mutation** — any byte-level change breaks the signature.
- **Record reordering** — the `prevHash` chain breaks.
- **Record deletion in the middle** — `prevHash` mismatch on the next record.

What it does **not** catch by default:

- **Tail truncation** — if an attacker deletes the tail, no record survives to flag it. Mitigation: `headAnchorIntervalMs` writes the latest `(sequence, hash)` pair to an out-of-band notarization channel (queued for v1.3.0 to be wired into the CAS-based atomic head update).
- **Multi-pod races** — v1.2.0 is **single-writer only**. Multiple pods writing to the same store will produce a loud warning and may interleave sequences. Route writes to a single elected leader pod or use per-pod chains and stitch offline. CAS-based atomic chain head is queued for v1.3.0.

## Examples

| Example                                                       | Level        | Description                                                                                 |
| ------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| [`verify-chain`](../examples/skill-audit-log/verify-chain.md) | Intermediate | Verify a stored chain offline using verifyChain and the bundle-signing key registry.        |
| [`custom-store`](../examples/skill-audit-log/custom-store.md) | Advanced     | Implement a custom SkillAuditStore that streams records to S3 with one object per sequence. |

> See all examples in [`examples/skill-audit-log/`](../examples/skill-audit-log/)

## Reference

- [Skill Audit Log](https://docs.agentfront.dev/frontmcp/extensibility/skill-audit-log)
- Related skills: `configure-skills-http`, `create-plugin`
