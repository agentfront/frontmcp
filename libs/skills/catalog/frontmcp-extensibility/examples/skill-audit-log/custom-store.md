---
name: custom-store
reference: skill-audit-log
level: advanced
description: Implement a custom SkillAuditStore that streams records to S3 with one object per sequence.
tags: [extensibility, audit, custom, s3, store]
features:
  - 'Implements the SkillAuditStore interface (nextSequence, appendAtSequence, tail, read)'
  - 'One S3 object per sequence keeps individual records immutable and verifiable'
  - 'tail() returns the latest record so the writer can chain prevHash deterministically'
  - 'read({ from, limit }) supports incremental verifyChain runs in CI'
---

# Custom S3-Backed Audit Store

Implement a custom SkillAuditStore that streams records to S3 with one object per sequence.

## Code

```typescript
// src/audit/s3-audit.store.ts
//
// Implements the actual SkillAuditStore contract:
//   - nextSequence(): allocate the next monotonic sequence atomically.
//     Backed here by an S3 conditional-put on a counter object; production
//     deployments MUST front this with a real atomic counter (DynamoDB,
//     Redis, etc.) since S3 alone cannot guarantee monotonic allocation
//     under concurrency.
//   - appendAtSequence(record): persist with IfNoneMatch:'*' so a retry
//     after a partial failure doesn't overwrite the record.
//   - tail(): return the most recent record for prevHash chaining.
//   - read({ from, limit }): walk records in order for verifyChain.
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { SkillAuditRecord, SkillAuditStore } from '@frontmcp/adapters/skills';

const padSequence = (sequence: number): string => sequence.toString().padStart(20, '0');

export class S3AuditStore implements SkillAuditStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly prefix: string,
    /**
     * Atomic sequence allocator. S3 alone cannot allocate monotonic
     * sequences safely under concurrency — wire this to DynamoDB
     * `UpdateItem` with `ADD seq :one` or to a Redis `incr`. The default
     * provided here scans the prefix and returns `max+1`, which is only
     * safe for single-writer deployments.
     */
    private readonly seq: { next(): Promise<number> } = {
      next: async () => {
        const all = await this.list();
        // Use the highest observed sequence rather than count: a gap in the
        // prefix (e.g. compacted/migrated history) would otherwise let the
        // allocator collide with an existing key.
        return Math.max(0, ...all.map((r) => r.sequence)) + 1;
      },
    },
  ) {}

  async nextSequence(): Promise<number> {
    return this.seq.next();
  }

  async appendAtSequence(record: SkillAuditRecord): Promise<void> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: `${this.prefix}${padSequence(record.sequence)}.json`,
          Body: JSON.stringify(record),
          ContentType: 'application/json',
          // Block silent overwrites — chain entries are immutable.
          IfNoneMatch: '*',
        }),
      );
    } catch (e) {
      // S3 returns 412 PreconditionFailed when IfNoneMatch:'*' rejects the
      // write. The SDK surfaces it via the error's `name` field — there is
      // no dedicated S3 exception class to instanceof against.
      if ((e as { name?: string })?.name === 'PreconditionFailed') {
        throw new Error(`record at sequence ${record.sequence} already exists`);
      }
      throw e;
    }
  }

  async tail(): Promise<SkillAuditRecord | undefined> {
    const all = await this.read();
    return all[all.length - 1];
  }

  async read(opts?: { from?: number; limit?: number }): Promise<SkillAuditRecord[]> {
    const from = opts?.from ?? 1;
    const limit = opts?.limit;
    const startKey = from > 1 ? `${this.prefix}${padSequence(from - 1)}.json` : undefined;
    const records = await this.list(startKey);
    const filtered = records.filter((r) => r.sequence >= from).sort((a, b) => a.sequence - b.sequence);
    return limit !== undefined ? filtered.slice(0, limit) : filtered;
  }

  private async list(startAfter?: string): Promise<SkillAuditRecord[]> {
    const records: SkillAuditRecord[] = [];
    // ListObjectsV2 caps each response at 1000 objects. Page until the
    // bucket returns an un-truncated response so verifyChain sees the full
    // chain even in long-lived audit logs.
    let continuationToken: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix,
          // StartAfter is only meaningful on the first page; subsequent
          // pages drive ordering via ContinuationToken.
          StartAfter: continuationToken === undefined ? startAfter : undefined,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of page.Contents ?? []) {
        if (!obj.Key) continue;
        const body = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: obj.Key }));
        const text = (await body.Body?.transformToString()) ?? '';
        records.push(JSON.parse(text) as SkillAuditRecord);
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return records;
  }
}
```

```typescript
// src/server.ts
import { S3Client } from '@aws-sdk/client-s3';

import {
  Hs256AuditSigner,
  MemoryAuditStore,
  Rs256AuditSigner,
  setSkillAuditFactory,
  SkillAuditWriter,
  SkillAuditWriterToken,
} from '@frontmcp/adapters/skills';
import { FrontMcp } from '@frontmcp/sdk';

import { S3AuditStore } from './audit/s3-audit.store';
import { MainApp } from './main.app';

// SDK constructs the writer using the positional signature
// `new SkillAuditWriter(store, signer, logger, metrics?, options?)`.
setSkillAuditFactory(() => ({
  SkillAuditWriterToken,
  SkillAuditWriter,
  Hs256AuditSigner,
  MemoryAuditStore,
}));

const s3Store = new S3AuditStore(new S3Client({ region: 'us-east-1' }), 'audit-prod', 'skill-audit/');

// Fail loudly at boot rather than burying a `JSON.parse(undefined)` stack
// trace inside the audit writer — operators wiring this up should see a
// descriptive config error.
const privateJwkJson = process.env.BUNDLE_SIGNING_PRIVATE_JWK;
if (!privateJwkJson) {
  throw new Error('BUNDLE_SIGNING_PRIVATE_JWK env var is required for the RS256 audit signer');
}
const privateJwk = JSON.parse(privateJwkJson) as JsonWebKey;

@FrontMcp({
  info: { name: 'svr', version: '1.0.0' },
  apps: [MainApp],
  skillsConfig: {
    enabled: true,
    audit: {
      enabled: true,
      // Constructor signature: new Rs256AuditSigner(privateJwk, keyId)
      signer: new Rs256AuditSigner(privateJwk, 'bundle-signing-2026-01'),
      store: s3Store,
      subjectMode: 'hash',
    },
  },
})
export default class Server {}
```

## What This Demonstrates

- Implements the SkillAuditStore interface (nextSequence, appendAtSequence, tail, read)
- One S3 object per sequence keeps individual records immutable and verifiable
- tail() returns the latest record so the writer can chain prevHash deterministically
- read({ from, limit }) supports incremental verifyChain runs in CI

## Related

- See `skill-audit-log` for the full interface
- See `verify-chain` for periodic offline verification
