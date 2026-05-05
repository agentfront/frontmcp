---
name: custom-store
reference: skill-audit-log
level: advanced
description: Implement a custom SkillAuditStore that streams records to S3 with one object per sequence.
tags: [extensibility, audit, custom, s3, store]
features:
  - 'Implements the SkillAuditStore interface (append, tail, iterate)'
  - 'One S3 object per sequence keeps individual records immutable and verifiable'
  - 'tail(limit) lists the last N keys in lexical order — sequences are zero-padded'
  - 'iterate(after?) supports incremental verifyChain runs in CI'
---

# Custom S3-Backed Audit Store

Implement a custom SkillAuditStore that streams records to S3 with one object per sequence.

## Code

```typescript
// src/audit/s3-audit.store.ts
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { SkillAuditRecord, SkillAuditStore } from '@frontmcp/adapters/skills';

const padSequence = (sequence: number): string => sequence.toString().padStart(20, '0');

export class S3AuditStore implements SkillAuditStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly prefix: string,
  ) {}

  async append(record: SkillAuditRecord): Promise<void> {
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
  }

  async tail(limit: number): Promise<SkillAuditRecord[]> {
    const all = await this.iterate();
    return all.slice(-limit);
  }

  async iterate(after?: number): Promise<SkillAuditRecord[]> {
    const startKey = after !== undefined ? `${this.prefix}${padSequence(after + 1)}.json` : undefined;
    const list = await this.s3.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.prefix, StartAfter: startKey }),
    );

    const records: SkillAuditRecord[] = [];
    for (const obj of list.Contents ?? []) {
      if (!obj.Key) continue;
      const body = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: obj.Key }));
      const text = await body.Body!.transformToString();
      records.push(JSON.parse(text) as SkillAuditRecord);
    }
    return records;
  }
}
```

```typescript
// src/server.ts
import { S3Client } from '@aws-sdk/client-s3';

import { Rs256AuditSigner, setSkillAuditFactory, SkillAuditWriter } from '@frontmcp/adapters/skills';
import { FrontMcp } from '@frontmcp/sdk';

import { S3AuditStore } from './audit/s3-audit.store';
import { MainApp } from './main.app';

setSkillAuditFactory(({ signer, store, subjectMode }) => new SkillAuditWriter({ signer, store, subjectMode }));

const s3Store = new S3AuditStore(new S3Client({ region: 'us-east-1' }), 'audit-prod', 'skill-audit/');

@FrontMcp({
  info: { name: 'svr', version: '1.0.0' },
  apps: [MainApp],
  skillsConfig: {
    enabled: true,
    audit: {
      enabled: true,
      signer: new Rs256AuditSigner({
        keyId: 'bundle-signing-2026-01',
        privateKeyPem: process.env.BUNDLE_SIGNING_PRIVATE_KEY!,
      }),
      store: s3Store,
      subjectMode: 'hash',
    },
  },
})
export default class Server {}
```

## What This Demonstrates

- Implements the SkillAuditStore interface (append, tail, iterate)
- One S3 object per sequence keeps individual records immutable and verifiable
- tail(limit) lists the last N keys in lexical order — sequences are zero-padded
- iterate(after?) supports incremental verifyChain runs in CI

## Related

- See `skill-audit-log` for the full interface
- See `verify-chain` for periodic offline verification
