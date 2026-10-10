---
name: skill-audit-log
description: Tamper-evident, hash-chained audit log for skill action executions — pluggable signer, pluggable store, offline verification.
tags: [extensibility, audit, skills, tamper-evident, signature, chain]
---

# Skill Audit Log

The `@frontmcp/adapters/skills` module provides a tamper-evident, hash-chained audit log for skill action executions. Each authority pass / authority fail / HTTP success / HTTP failure phase emitted by the skill-action executor (`run_workflow`'s `callTool`, from `@frontmcp/plugin-skilled-openapi`) is signed and chained so any later mutation breaks signature verification. Capture is best-effort: a record whose signing or append fails, or that is dropped because the write queue is full, is not in the log; those cases are logged as `[skill-audit]` warnings and counted when `skillsConfig.audit.metrics` is set.

## Architecture

The writer exposes one method per phase rather than a generic `append`. Each
phase method assembles its payload internally and routes through a shared
chain pipeline:

```text
run_workflow → callTool(action)
  ├── writer.writeAuthorityPass(ctx)             // authority-check-pass
  ├── writer.writeAuthorityFail(ctx, { reason }) // authority-check-fail
  ├── writer.writeHttpCallSuccess(ctx, { status, output })  // http-call-success
  └── writer.writeHttpCallFailure(ctx, { status, error })   // http-call-failure
       └── shared pipeline:
            ├── store.tail()                     → previous record
            ├── store.nextSequence()             → atomic monotonic counter
            ├── compute prevHash from previous record
            ├── assemble SkillAuditRecord { sequence, prevHash, phase, ... }
            ├── SkillAuditSigner.sign(record)    → { signature, keyId, alg }
            └── store.appendAtSequence(signedRecord)
```

The `write*` methods queue the record and never reject: a failed sign or append is logged as a `[skill-audit]` warning and the tool call carries on.

Each record matches the outcome the caller got. An action whose input fails its schema is recorded as `http-call-failure` with `status: 0` (no request is sent), and an answer that fails the operation's `outputSchema` as `http-call-failure` with the upstream status, both with the reason in `errorMessage`. `http-call-success` is written only for an answer the caller receives.

Each `SkillAuditRecord` carries:

| Field            | Description                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `id`             | UUID of the record, for correlating with downstream sinks                                               |
| `sequence`       | Strictly increasing position in the chain, starting at 1                                                |
| `timestamp`      | ISO-8601 UTC time the record was written                                                                |
| `prevHash`       | SHA-256 hex of the previous record's canonical bytes (genesis sentinel `'0'.repeat(64)` for sequence 1) |
| `signature`      | Base64url signature over the canonical record bytes                                                     |
| `signatureKeyId` | The signer key identifier — used by verifiers to look up the public key                                 |
| `signatureAlg`   | `'HS256'` or `'RS256'`                                                                                  |
| `phase`          | `'authority-check-pass' \| 'authority-check-fail' \| 'http-call-success' \| 'http-call-failure'`        |
| `skillId`        | The skill that owns the action                                                                          |
| `actionId`       | The action that was executed                                                                            |
| `subject`        | Authenticated principal — redacted per `subjectMode`                                                    |
| `bundleId`       | The bundle the action was resolved against                                                              |
| `bundleVersion`  | The bundle version active at the time of the call                                                       |
| `status`         | HTTP status, on the `http-call-*` phases                                                                |
| `inputHash`      | SHA-256 hex of the canonical input — the input itself is never stored                                   |
| `outputHash`     | SHA-256 hex of the canonical response body, on `http-call-success`                                      |
| `errorMessage`   | Truncated error (or denial reason), on `http-call-failure` and `authority-check-fail`                   |

## Configuration

Wire the audit subsystem through `skillsConfig.audit` on `@FrontMcp`:

```typescript
import * as auditModule from '@frontmcp/adapters/skills';
import { createSkillAuditMetrics, Hs256AuditSigner, MemoryAuditStore } from '@frontmcp/adapters/skills';
import { createCounter } from '@frontmcp/observability';
import { FrontMcp, setSkillAuditFactory } from '@frontmcp/sdk';
import { randomBytes } from '@frontmcp/utils';

import { MainApp } from './main.app';

// Not needed with @frontmcp/plugin-skilled-openapi installed: the plugin registers the module.
setSkillAuditFactory(() => auditModule);

@FrontMcp({
  info: { name: 'svr', version: '1.0.0' },
  apps: [MainApp],
  skillsConfig: {
    enabled: true,
    audit: {
      enabled: true,
      signer: new Hs256AuditSigner(randomBytes(32), 'dev'),
      store: new MemoryAuditStore(),
      metrics: createSkillAuditMetrics({ createCounter }),
      subjectMode: 'hash', // 'plain' | 'hash' | 'omit'
      subjectHashSecret: process.env.AUDIT_SUBJECT_HASH_SECRET, // optional, at least 32 bytes
    },
  },
})
class Server {}
```

`setSkillAuditFactory(factory)` takes a function with no arguments that returns the audit module. The SDK does **not** statically depend on `@frontmcp/adapters/skills` — this keeps the static dependency graph clean and works in Edge / CSP runtimes. From the module it reads `SkillAuditWriterToken`, `SkillAuditWriter`, `Hs256AuditSigner` and `MemoryAuditStore`, builds the writer itself as `new SkillAuditWriter(store, signer, logger, metrics, { subjectMode, subjectHashSecret })`, and registers it under `SkillAuditWriterToken`. `@frontmcp/plugin-skilled-openapi`, whose `run_workflow` is what writes the records, registers the module itself when it is constructed (a factory you registered is kept), so with the plugin installed `skillsConfig.audit` works without the call.

`createSkillAuditMetrics({ createCounter })` turns any counter factory into the writer's metrics sink. With `createCounter` from `@frontmcp/observability`, a failed write increments `frontmcp_skills_audit_write_failures_total{reason}` (`sign`, `append`, `unexpected`) and a dropped record increments `frontmcp_skills_audit_dropped_total{reason}` (`queue-overflow`). Without `metrics`, failed and dropped writes surface only as `[skill-audit]` warnings in the server log.

With `audit.enabled` and no module registered (no plugin, no `setSkillAuditFactory`), the server logs a warning and runs without the audit log in development, and refuses to start when `NODE_ENV` is `production`. A `signer` and `store` do not replace the module: the writer class comes from it.

| `skillsConfig.audit` field | Type                          | Default   |
| -------------------------- | ----------------------------- | --------- |
| `enabled`                  | `boolean`                     | `false`   |
| `signer`                   | `SkillAuditSigner`            | dev HS256 |
| `store`                    | `SkillAuditStore`             | memory    |
| `metrics`                  | `SkillAuditMetrics`           | unset     |
| `subjectMode`              | `'plain' \| 'hash' \| 'omit'` | `'hash'`  |
| `subjectHashSecret`        | `string \| Uint8Array`        | derived   |
| `headAnchorIntervalMs`     | `number \| undefined`         | unset     |

`headAnchorIntervalMs` is validated but not read yet: it is reserved for head anchoring (see the threat model below).

### Subject hashes

With `subjectMode: 'hash'` (the default) each record's `subject` is `hashed:<HMAC-SHA256 of the subject, 32 hex chars>`. The HMAC key is `subjectHashSecret` when you set it (at least 32 bytes; a string is UTF-8 encoded). Without it, the key is derived from the signer's key material with HKDF-SHA256 (info `frontmcp:audit:subject`): from the HMAC secret of an `Hs256AuditSigner`, from the private key of an `Rs256AuditSigner`. The key never appears in a record, so the hashes cannot be recomputed from what the log holds.

- A derived key changes with the signing key, and so do the hashes: records signed before and after a key rotation no longer join on `subject`. Set `subjectHashSecret` to keep hashes stable across rotations.
- Releases up to 1.9.4 derived the default key from the public `keyId`; hashes written by them do not match the ones written now for the same subject, unless `subjectHashSecret` was set.
- A custom signer joins in by implementing `deriveKey(info, length)` (see below). A signer that has no key material it can derive from (an HSM or KMS signer) leaves it out: the writer then records `subject: 'redacted'`, as `'omit'` does, and logs a `[skill-audit]` warning at startup naming `subjectHashSecret`.

## Built-in Signers

| Signer             | Key                                                 | When to use                                                                                                                                           |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Hs256AuditSigner` | Symmetric HMAC-SHA-256                              | Dev / tests. Verifying needs the same secret, so it cannot be handed to an external auditor. A random secret makes records unverifiable after restart |
| `Rs256AuditSigner` | Asymmetric RSA (RS256, RSASSA-PKCS1-v1_5 + SHA-256) | **Production.** Reuse the bundle-signing keypair so the same trust root covers both                                                                   |

Without a `signer`, the SDK builds an HS256 signer with a random, process-local secret and warns; when `NODE_ENV` is `production` it refuses to start instead. Without a `store`, it uses `MemoryAuditStore` and warns; when `NODE_ENV` is `production` and audit is enabled it refuses to start instead, and the error names the fix: configure `skillsConfig.audit.store`, for example a `StorageAdapterAuditStore` over Redis.

A custom signer implements `sign(record)`, `getKeyId()`, `getAlg()` and, optionally, `deriveKey(info, length)`: return an HKDF-derived key from the signer's own key material (never the material itself) so `subjectMode: 'hash'` can key its HMAC without `subjectHashSecret`.

```typescript
import { Rs256AuditSigner } from '@frontmcp/adapters/skills';

// new Rs256AuditSigner(privateJwk, keyId): the private key is an RSA JWK (kty, n, e, d).
const privateJwkJson = process.env.BUNDLE_SIGNING_PRIVATE_JWK;
if (!privateJwkJson) throw new Error('BUNDLE_SIGNING_PRIVATE_JWK is not set');
const signer = new Rs256AuditSigner(JSON.parse(privateJwkJson) as JsonWebKey, 'bundle-signing-2026-01');
```

If your key is stored as PEM, convert it to a JWK once, for example with Node's `createPrivateKey(pem).export({ format: 'jwk' })`. `Rs256AuditSigner` uses `rsaSignBase64Url` from `@frontmcp/utils` under the hood.

## Built-in Stores

| Store                      | Persistence                                               | When to use      |
| -------------------------- | --------------------------------------------------------- | ---------------- |
| `MemoryAuditStore`         | In-process; lost on restart                               | Tests, local dev |
| `StorageAdapterAuditStore` | Any `@frontmcp/utils` storage adapter (Redis, KV, SQLite) | Production       |

```typescript
import { StorageAdapterAuditStore } from '@frontmcp/adapters/skills';
import { createStorage } from '@frontmcp/utils';

// createStorage() returns a RootStorage, which is a StorageAdapter.
const storage = await createStorage({ type: 'redis', redis: { config: { host: 'localhost', port: 6379 } } });
const store = new StorageAdapterAuditStore(storage);

// Or construct a concrete adapter directly:
// import { RedisStorageAdapter } from '@frontmcp/utils';
// const store = new StorageAdapterAuditStore(new RedisStorageAdapter({ config: { host: 'localhost', port: 6379 } }));
```

A custom store implements:

```typescript
interface SkillAuditStore {
  /** Allocate the next monotonic sequence atomically. Maps to StorageAdapter.incr in production. */
  nextSequence(): Promise<number>;

  /** Persist a record at its claimed sequence. MUST refuse / throw if the slot is taken. */
  appendAtSequence(record: SkillAuditRecord): Promise<void>;

  /** Most recent record (or undefined for empty chain). Drives prevHash for the next write. */
  tail(): Promise<SkillAuditRecord | undefined>;

  /** Read records in sequence order; supports `{ from, limit }` for incremental verification. */
  read(opts?: { from?: number; limit?: number }): Promise<SkillAuditRecord[]>;

  /** Optional: give back a number from nextSequence() whose record was never appended, so the chain has no gap. */
  releaseSequence?(sequence: number): Promise<void>;
}
```

When a record fails to sign or append after its sequence was allocated, the writer calls `releaseSequence(sequence)`. `MemoryAuditStore` gives the number back; `StorageAdapterAuditStore` decrements its counter (not transactional across pods). A store without it leaves a gap, which `verifyChain` reports as `sequence gap`.

See [`custom-store`](../examples/skill-audit-log/custom-store.md) for an S3-backed implementation.

## Verifying the Chain

```typescript
import { defaultAuditSignatureVerifier, verifyChain, type AuditTrustedKey } from '@frontmcp/adapters/skills';

// `read()` walks the chain in sequence order; pass `{ from, limit }` for
// incremental verification in CI.
const records = await store.read();

// Trusted keys are passed as an array (per-record `signatureKeyId` selects
// which entry to use). Supply `publicJwk` or `publicKeyPem` for RS256, or
// `secret` for HS256.
const publicKeyPem = process.env.BUNDLE_SIGNING_PUBLIC_KEY_PEM;
if (!publicKeyPem) throw new Error('BUNDLE_SIGNING_PUBLIC_KEY_PEM is not set');
const trustedKeys: AuditTrustedKey[] = [{ keyId: 'bundle-signing-2026-01', alg: 'RS256', publicKeyPem }];

const result = verifyChain(records, trustedKeys, defaultAuditSignatureVerifier);

if (result.ok) {
  console.log(`Chain verified: ${result.verified} record(s) checked`);
} else {
  console.error('Chain broken at sequence', result.breakAt, '—', result.reason);
}
```

To verify a window from the middle of the chain (incremental checks in CI), pass the record just before it as `previous`: the window's first record must follow it and carry its hash as `prevHash`. Use the last record of the previous verified run, or read one record earlier and verify it in the same run:

```typescript
const [previous, ...window] = await store.read({ from: lastVerifiedSequence, limit: 1001 });
const windowResult = verifyChain(window, trustedKeys, defaultAuditSignatureVerifier, { previous });
```

Without `previous`, the first record must be the chain's first (its `prevHash` is the genesis sentinel), so a chain whose first records were removed still fails.

`verifyChain` returns `{ ok: true; verified: number } | { ok: false; breakAt: number; reason: string }`. The `verified` count is the number of records whose signature + prevHash checked out — useful for dashboards and CI assertions. `defaultAuditSignatureVerifier` understands HS256 and RS256 records and dispatches based on `record.signatureAlg`.

## DI Integration

`SkillAuditWriterToken` is the DI token for the active writer. Plugins that need to emit additional audit records (e.g., a custom authority gate) can resolve it. A hook receives the flow, whose `scope` is protected and whose `get()` throws for a token nothing registered, so resolve the writer through the tool's execution context: `tryGet()` returns `undefined` when `skillsConfig.audit` is not enabled (no warning is logged for a token nothing registered).

```typescript
import { SkillAuditWriterToken } from '@frontmcp/adapters/skills';
import { Plugin, ToolHook, type FlowCtxOf } from '@frontmcp/sdk';

@Plugin({ name: 'authority-audit' })
export default class AuthorityAuditPlugin {
  @ToolHook.Will('execute')
  recordAuthorityPass(flowCtx: FlowCtxOf<'tools:call-tool'>): void {
    const toolContext = flowCtx.state.required.toolContext;
    const writer = toolContext.tryGet(SkillAuditWriterToken);
    // Use the phase-specific method matching the event you're recording.
    // The writer assembles the canonical record (sequence, prevHash,
    // signature, signatureKeyId, signatureAlg) for you.
    void writer?.writeAuthorityPass({
      subject: 'user-id',
      skillId: 'my-skill',
      actionId: 'my-action',
      bundleId: 'bundle:id',
      bundleVersion: '1.0.0',
      input: toolContext.input,
    });
  }
}
```

The `write*` methods queue the record and never reject, so `void` keeps the tool call from waiting on the audit store.

Plugins should always go through `SkillAuditWriterToken` rather than rolling their own audit log so the chain stays unified.

## Threat Model

What the audit log catches:

- **Record mutation** — any byte-level change breaks the signature.
- **Record reordering** — the `prevHash` chain breaks.
- **Record deletion in the middle** — `prevHash` mismatch on the next record.

What it does **not** catch by default:

- **Tail truncation** — if an attacker deletes the tail, no record survives to flag it. Head anchoring (`headAnchorIntervalMs`) is reserved but not implemented: until it ships, record the latest `(sequence, record hash)` pair out of band yourself.
- **Multi-pod races** — the writer is **single-writer only**. It serializes writes within one process, but two pods can read the same tail and link their records to it; `verifyChain` then reports a `prevHash` mismatch. Route writes to a single elected leader pod or use per-pod chains and stitch offline.

## Examples

| Example                                                       | Level        | Description                                                                                 |
| ------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| [`verify-chain`](../examples/skill-audit-log/verify-chain.md) | Intermediate | Verify a stored chain offline using verifyChain and the bundle-signing key registry.        |
| [`custom-store`](../examples/skill-audit-log/custom-store.md) | Advanced     | Implement a custom SkillAuditStore that streams records to S3 with one object per sequence. |

> See all examples in [`examples/skill-audit-log/`](../examples/skill-audit-log/)

## Reference

- [Skill Audit Log](https://docs.agentfront.dev/frontmcp/extensibility/skill-audit-log)
- Related skills: `configure-skills-http`, `create-plugin`
