// file: libs/adapters/src/skills/audit/__tests__/audit-writer.spec.ts

import { verifyChain, type AuditTrustedKey } from '../audit-chain';
import { defaultAuditSignatureVerifier, Hs256AuditSigner } from '../audit-signer';
import { MemoryAuditStore, type SkillAuditStore } from '../audit-store';
import { SkillAuditWriter, type SkillAuditLogger, type SkillAuditMetrics } from '../audit-writer';

function makeLogger(): SkillAuditLogger & { warns: unknown[][]; debugs: unknown[][] } {
  const warns: unknown[][] = [];
  const debugs: unknown[][] = [];
  return {
    warns,
    debugs,
    warn: (...args: unknown[]) => {
      warns.push(args);
    },
    debug: (...args: unknown[]) => {
      debugs.push(args);
    },
  };
}

function makeMetrics(): SkillAuditMetrics & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    incrementWriteFailure: (reason) => {
      calls.push(reason);
    },
  };
}

const SECRET = 'writer-test-secret';
const KEY_ID = 'writer-key';
const TRUSTED: AuditTrustedKey[] = [{ keyId: KEY_ID, alg: 'HS256', secret: new TextEncoder().encode(SECRET) }];

function makeWriter(opts: { subjectMode?: 'plain' | 'hash' | 'omit' } = {}): {
  writer: SkillAuditWriter;
  store: MemoryAuditStore;
  logger: ReturnType<typeof makeLogger>;
  metrics: ReturnType<typeof makeMetrics>;
} {
  const store = new MemoryAuditStore();
  const signer = new Hs256AuditSigner(SECRET, KEY_ID);
  const logger = makeLogger();
  const metrics = makeMetrics();
  // Most legacy tests assert against the raw subject string — opt them in
  // to plain mode explicitly. New behavioral tests for the default
  // `subjectMode: 'hash'` path below construct their own writer.
  return {
    writer: new SkillAuditWriter(store, signer, logger, metrics, {
      subjectMode: opts.subjectMode ?? 'plain',
    }),
    store,
    logger,
    metrics,
  };
}

const ctx = {
  subject: 'user-1',
  skillId: 'billing',
  actionId: 'createInvoice',
  bundleId: 'acme:prod',
  bundleVersion: '1.0.0',
  input: { amount: 100, currency: 'USD' },
};

describe('SkillAuditWriter', () => {
  it('writes an authority-pass record at sequence 1 with genesis prevHash', async () => {
    const { writer, store } = makeWriter();
    await writer.writeAuthorityPass(ctx);
    const all = await store.read();
    expect(all.length).toBe(1);
    expect(all[0]!.sequence).toBe(1);
    expect(all[0]!.phase).toBe('authority-check-pass');
    expect(all[0]!.prevHash).toMatch(/^0{64}$/);
    expect(all[0]!.signatureAlg).toBe('HS256');
    expect(all[0]!.signatureKeyId).toBe(KEY_ID);
  });

  it('chains records correctly across multiple phases', async () => {
    const { writer, store } = makeWriter();
    await writer.writeAuthorityPass(ctx);
    await writer.writeHttpCallSuccess(ctx, { status: 200, output: { id: 'inv-1' } });
    const all = await store.read();
    expect(all.length).toBe(2);
    expect(all[1]!.phase).toBe('http-call-success');
    expect(all[1]!.outputHash).toBeDefined();
    expect(all[1]!.status).toBe(200);

    const result = verifyChain(all, TRUSTED, defaultAuditSignatureVerifier);
    expect(result).toEqual({ ok: true, verified: 2 });
  });

  it('writes failure records with truncated error messages', async () => {
    const { writer, store } = makeWriter();
    await writer.writeAuthorityPass(ctx);
    const longError = 'x'.repeat(1000);
    await writer.writeHttpCallFailure(ctx, { status: 500, error: longError });
    const all = await store.read();
    expect(all[1]!.phase).toBe('http-call-failure');
    expect(all[1]!.errorMessage).toBeDefined();
    expect(all[1]!.errorMessage!.length).toBeLessThanOrEqual(503);
    expect(all[1]!.errorMessage!.endsWith('...')).toBe(true);
    expect(all[1]!.outputHash).toBeUndefined();
  });

  it('handles Error instances in the failure path', async () => {
    const { writer, store } = makeWriter();
    await writer.writeHttpCallFailure(ctx, { status: 0, error: new Error('connection refused') });
    const all = await store.read();
    expect(all[0]!.errorMessage).toBe('connection refused');
  });

  it('falls back to "anonymous" when subject is empty', async () => {
    const { writer, store } = makeWriter();
    await writer.writeAuthorityPass({ ...ctx, subject: '' });
    const all = await store.read();
    expect(all[0]!.subject).toBe('anonymous');
  });

  it('produces stable canonicalization across runs (input hash determinism)', async () => {
    const { writer, store } = makeWriter();
    await writer.writeAuthorityPass({ ...ctx, input: { a: 1, b: 2 } });

    // Re-run with key-shuffled input — should produce the same inputHash.
    const { writer: w2, store: s2 } = makeWriter();
    await w2.writeAuthorityPass({ ...ctx, input: { b: 2, a: 1 } });

    const r1 = (await store.read())[0]!;
    const r2 = (await s2.read())[0]!;
    expect(r1.inputHash).toBe(r2.inputHash);
  });

  it('does NOT throw when the store fails to append', async () => {
    const failingStore: SkillAuditStore = {
      nextSequence: async () => 1,
      appendAtSequence: async () => {
        throw new Error('redis down');
      },
      tail: async () => undefined,
      read: async () => [],
    };
    const signer = new Hs256AuditSigner(SECRET, KEY_ID);
    const logger = makeLogger();
    const metrics = makeMetrics();
    const writer = new SkillAuditWriter(failingStore, signer, logger, metrics);

    await expect(writer.writeAuthorityPass(ctx)).resolves.toBeUndefined();
    expect(logger.warns.length).toBeGreaterThan(0);
    expect(metrics.calls).toContain('append');
  });

  it('does NOT throw when the signer fails', async () => {
    const store = new MemoryAuditStore();
    const failingSigner = {
      sign: () => {
        throw new Error('hsm offline');
      },
      getKeyId: () => 'k',
      getAlg: () => 'HS256' as const,
    };
    const logger = makeLogger();
    const metrics = makeMetrics();
    const writer = new SkillAuditWriter(store, failingSigner, logger, metrics);

    await expect(writer.writeAuthorityPass(ctx)).resolves.toBeUndefined();
    expect(logger.warns.length).toBeGreaterThan(0);
    expect(metrics.calls).toContain('sign');
    expect((await store.read()).length).toBe(0);
  });

  it('does NOT throw when nextSequence fails', async () => {
    const failingStore: SkillAuditStore = {
      nextSequence: async () => {
        throw new Error('counter unreachable');
      },
      appendAtSequence: async () => undefined,
      tail: async () => undefined,
      read: async () => [],
    };
    const signer = new Hs256AuditSigner(SECRET, KEY_ID);
    const logger = makeLogger();
    const metrics = makeMetrics();
    const writer = new SkillAuditWriter(failingStore, signer, logger, metrics);

    await expect(writer.writeAuthorityPass(ctx)).resolves.toBeUndefined();
    expect(metrics.calls).toContain('append');
  });

  it('serializes concurrent writes correctly (no duplicate prevHashes)', async () => {
    const { writer, store } = makeWriter();
    await Promise.all([
      writer.writeAuthorityPass(ctx),
      writer.writeAuthorityPass(ctx),
      writer.writeAuthorityPass(ctx),
      writer.writeAuthorityPass(ctx),
    ]);
    const all = await store.read();
    expect(all.length).toBe(4);
    // All sequences should be unique.
    const seqs = new Set(all.map((r) => r.sequence));
    expect(seqs.size).toBe(4);
    // Chain should verify cleanly.
    const result = verifyChain(all, TRUSTED, defaultAuditSignatureVerifier);
    expect(result.ok).toBe(true);
  });

  it('persists outputHash for success records and omits it for failure', async () => {
    const { writer, store } = makeWriter();
    await writer.writeHttpCallSuccess(ctx, { status: 200, output: { ok: true } });
    await writer.writeHttpCallFailure(ctx, { status: 502, error: 'bad gateway' });

    const all = await store.read();
    expect(all[0]!.outputHash).toBeDefined();
    expect(all[0]!.errorMessage).toBeUndefined();
    expect(all[1]!.outputHash).toBeUndefined();
    expect(all[1]!.errorMessage).toBe('bad gateway');
  });

  it('handles non-canonicalizable output gracefully (circular refs)', async () => {
    const { writer, store } = makeWriter();
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    await writer.writeHttpCallSuccess(ctx, { status: 200, output: circular });
    const all = await store.read();
    expect(all.length).toBe(1);
    // outputHash is a sha256 hex (64 chars) — fallback or otherwise.
    expect(all[0]!.outputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes an authority-check-fail record with the denial reason', async () => {
    const { writer, store } = makeWriter();
    await writer.writeAuthorityFail(ctx, { reason: 'roles missing: admin' });
    const all = await store.read();
    expect(all.length).toBe(1);
    expect(all[0]!.phase).toBe('authority-check-fail');
    expect(all[0]!.errorMessage).toBe('roles missing: admin');
    // Denials are still hash-chained and signed alongside other records.
    const result = verifyChain(all, TRUSTED, defaultAuditSignatureVerifier);
    expect(result.ok).toBe(true);
  });

  it('does not produce a sequence gap when signing fails (M4 regression)', async () => {
    // Backing adapter that exposes a real `decr` for sequence rollback.
    const seqMap = new Map<string, number>();
    const records = new Map<string, string>();
    const adapter = {
      get: async (k: string) => (records.has(k) ? records.get(k)! : seqMap.has(k) ? String(seqMap.get(k)) : null),
      set: async (k: string, v: string) => {
        records.set(k, v);
      },
      incr: async (k: string) => {
        const next = (seqMap.get(k) ?? 0) + 1;
        seqMap.set(k, next);
        return next;
      },
      decr: async (k: string) => {
        const next = (seqMap.get(k) ?? 0) - 1;
        seqMap.set(k, next);
        return next;
      },
    };
    const store = new (await import('../audit-store')).StorageAdapterAuditStore(adapter as never, {
      sequenceKey: 'audit:seq',
      recordKeyPrefix: 'audit:rec:',
    });
    let calls = 0;
    const flakySigner = {
      sign: (rec: { sequence: number }) => {
        calls += 1;
        // First call (sequence 1) fails; second call (which should still be
        // sequence 1 because we rolled back) succeeds.
        if (calls === 1) throw new Error('hsm timeout');
        return { signature: 'sig', keyId: KEY_ID, alg: 'HS256' as const };
      },
      getKeyId: () => KEY_ID,
      getAlg: () => 'HS256' as const,
    };
    const logger = makeLogger();
    const writer = new SkillAuditWriter(store, flakySigner, logger, undefined, {
      subjectMode: 'plain',
    });
    // First write: signer throws → sequence rolled back.
    await writer.writeAuthorityPass(ctx);
    // Second write: signer succeeds → should land at sequence 1, NOT 2.
    await writer.writeAuthorityPass(ctx);
    expect(seqMap.get('audit:seq')).toBe(1);
    expect(records.size).toBe(1);
  });

  it('subjectMode "hash" produces a stable hashed output across runs with same secret', async () => {
    const secret = new TextEncoder().encode('audit-subject-secret-stable');
    const store1 = new MemoryAuditStore();
    const store2 = new MemoryAuditStore();
    const sig1 = new Hs256AuditSigner(SECRET, KEY_ID);
    const sig2 = new Hs256AuditSigner(SECRET, KEY_ID);
    const w1 = new SkillAuditWriter(store1, sig1, makeLogger(), undefined, {
      subjectMode: 'hash',
      subjectHashSecret: secret,
    });
    const w2 = new SkillAuditWriter(store2, sig2, makeLogger(), undefined, {
      subjectMode: 'hash',
      subjectHashSecret: secret,
    });
    await w1.writeAuthorityPass({ ...ctx, subject: 'user-42' });
    await w2.writeAuthorityPass({ ...ctx, subject: 'user-42' });
    const r1 = (await store1.read())[0]!;
    const r2 = (await store2.read())[0]!;
    expect(r1.subject).toBe(r2.subject);
    expect(r1.subject.startsWith('hashed:')).toBe(true);
    // Different subjects produce different hashes.
    const store3 = new MemoryAuditStore();
    const w3 = new SkillAuditWriter(store3, new Hs256AuditSigner(SECRET, KEY_ID), makeLogger(), undefined, {
      subjectMode: 'hash',
      subjectHashSecret: secret,
    });
    await w3.writeAuthorityPass({ ...ctx, subject: 'user-99' });
    const r3 = (await store3.read())[0]!;
    expect(r3.subject).not.toBe(r1.subject);
    expect(r3.subject.startsWith('hashed:')).toBe(true);
  });

  it('subjectMode "omit" replaces subject with constant', async () => {
    const store = new MemoryAuditStore();
    const writer = new SkillAuditWriter(store, new Hs256AuditSigner(SECRET, KEY_ID), makeLogger(), undefined, {
      subjectMode: 'omit',
    });
    await writer.writeAuthorityPass({ ...ctx, subject: 'user-1' });
    const all = await store.read();
    expect(all[0]!.subject).toBe('redacted');
  });

  it('drops records on bounded queue overflow with metrics', async () => {
    // Slow store: each append parks for ~50ms so the writer's queue fills up
    // while we issue a synchronous flood of writes.
    let pending = 0;
    const slowStore: SkillAuditStore = {
      nextSequence: async () => {
        pending += 1;
        return pending;
      },
      appendAtSequence: async () => {
        await new Promise<void>((res) => setTimeout(() => res(), 50));
      },
      tail: async () => undefined,
      read: async () => [],
    };
    const logger = makeLogger();
    const metrics = makeMetrics();
    let dropped = 0;
    const writer = new SkillAuditWriter(
      slowStore,
      new Hs256AuditSigner(SECRET, KEY_ID),
      logger,
      {
        ...metrics,
        incrementDropped: (reason) => {
          if (reason === 'queue-overflow') dropped += 1;
        },
      },
      { maxQueueDepth: 2, subjectMode: 'plain' },
    );

    // Issue 5 writes synchronously — only first 2 should be queued.
    void writer.writeAuthorityPass(ctx);
    void writer.writeAuthorityPass(ctx);
    void writer.writeAuthorityPass(ctx);
    void writer.writeAuthorityPass(ctx);
    void writer.writeAuthorityPass(ctx);

    // Allow microtasks to settle.
    await new Promise((res) => setTimeout(res, 100));
    expect(dropped).toBeGreaterThanOrEqual(3);
  });

  it('flush() resolves only after all queued writes complete', async () => {
    const { writer, store } = makeWriter({ subjectMode: 'plain' });
    void writer.writeAuthorityPass(ctx);
    void writer.writeAuthorityPass(ctx);
    void writer.writeAuthorityPass(ctx);
    await writer.flush();
    expect((await store.read()).length).toBe(3);
  });
});
