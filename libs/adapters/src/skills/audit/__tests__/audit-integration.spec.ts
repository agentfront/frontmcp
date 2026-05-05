// file: libs/adapters/src/skills/audit/__tests__/audit-integration.spec.ts
//
// End-to-end test: simulate the call-site interactions ExecuteActionTool
// performs against the writer, then verify the resulting chain. Intentionally
// avoids spinning up a full SDK scope — the call shapes the tool produces
// are well-defined (writeAuthorityPass / writeHttpCallSuccess /
// writeHttpCallFailure), so we reproduce them verbatim. This catches
// regressions where a change to the writer breaks the verifier without
// requiring a heavyweight DI harness in this test.

import { generateKeyPairSync } from 'node:crypto';

import { verifyChain, type AuditTrustedKey } from '../audit-chain';
import { defaultAuditSignatureVerifier, Hs256AuditSigner, Rs256AuditSigner } from '../audit-signer';
import { MemoryAuditStore } from '../audit-store';
import { SkillAuditWriter } from '../audit-writer';

const SECRET = 'integration-secret';
const KEY_ID = 'integration-key';

const fakeCtx = {
  subject: 'jwt-sub-123',
  skillId: 'billing',
  actionId: 'createInvoice',
  bundleId: 'acme:prod',
  bundleVersion: '2024.05.01',
  input: { customerId: 'cus_1', amountCents: 9900 },
};

describe('audit chain — ExecuteActionTool simulated invocation flow', () => {
  it('captures success path: authority pass + http success', async () => {
    const store = new MemoryAuditStore();
    const signer = new Hs256AuditSigner(SECRET, KEY_ID);
    const logger = { warn: () => undefined, debug: () => undefined };
    const writer = new SkillAuditWriter(store, signer, logger, undefined, { subjectMode: 'plain' });

    // Phase 2: authority check passed.
    await writer.writeAuthorityPass(fakeCtx);
    // Phase 4: http call returned 200.
    await writer.writeHttpCallSuccess(fakeCtx, { status: 200, output: { invoiceId: 'inv_1' } });

    const records = await store.read();
    expect(records.length).toBe(2);
    expect(records[0]!.phase).toBe('authority-check-pass');
    expect(records[1]!.phase).toBe('http-call-success');
    expect(records[1]!.status).toBe(200);

    const trusted: AuditTrustedKey[] = [{ keyId: KEY_ID, alg: 'HS256', secret: new TextEncoder().encode(SECRET) }];
    expect(verifyChain(records, trusted, defaultAuditSignatureVerifier)).toEqual({ ok: true, verified: 2 });
  });

  it('captures failure path: authority pass + http failure', async () => {
    const store = new MemoryAuditStore();
    const signer = new Hs256AuditSigner(SECRET, KEY_ID);
    const logger = { warn: () => undefined };
    const writer = new SkillAuditWriter(store, signer, logger, undefined, { subjectMode: 'plain' });

    await writer.writeAuthorityPass(fakeCtx);
    await writer.writeHttpCallFailure(fakeCtx, { status: 503, error: 'upstream temporarily unavailable' });

    const records = await store.read();
    expect(records.length).toBe(2);
    expect(records[1]!.phase).toBe('http-call-failure');
    expect(records[1]!.status).toBe(503);
    expect(records[1]!.errorMessage).toContain('temporarily unavailable');

    const trusted: AuditTrustedKey[] = [{ keyId: KEY_ID, alg: 'HS256', secret: new TextEncoder().encode(SECRET) }];
    expect(verifyChain(records, trusted, defaultAuditSignatureVerifier).ok).toBe(true);
  });

  it('captures interleaved invocations from multiple subjects', async () => {
    const store = new MemoryAuditStore();
    const signer = new Hs256AuditSigner(SECRET, KEY_ID);
    const logger = { warn: () => undefined };
    const writer = new SkillAuditWriter(store, signer, logger, undefined, { subjectMode: 'plain' });

    const subjects = ['user-a', 'user-b', 'user-c'];
    for (const sub of subjects) {
      const c = { ...fakeCtx, subject: sub };
      await writer.writeAuthorityPass(c);
      await writer.writeHttpCallSuccess(c, { status: 200, output: { ok: true } });
    }

    const records = await store.read();
    expect(records.length).toBe(6);
    expect(records.map((r) => r.subject)).toEqual(['user-a', 'user-a', 'user-b', 'user-b', 'user-c', 'user-c']);

    const trusted: AuditTrustedKey[] = [{ keyId: KEY_ID, alg: 'HS256', secret: new TextEncoder().encode(SECRET) }];
    expect(verifyChain(records, trusted, defaultAuditSignatureVerifier).ok).toBe(true);
  });

  it('detects retroactive tampering in a real-shaped chain', async () => {
    const store = new MemoryAuditStore();
    const signer = new Hs256AuditSigner(SECRET, KEY_ID);
    const logger = { warn: () => undefined };
    const writer = new SkillAuditWriter(store, signer, logger, undefined, { subjectMode: 'plain' });

    await writer.writeAuthorityPass(fakeCtx);
    await writer.writeHttpCallSuccess(fakeCtx, { status: 200, output: { ok: true } });
    await writer.writeHttpCallSuccess(fakeCtx, { status: 200, output: { ok: true } });

    const records = await store.read();
    // Edit the first record's input hash retroactively.
    const tampered = [...records];
    tampered[0] = { ...tampered[0]!, inputHash: 'tampered-hash' };

    const trusted: AuditTrustedKey[] = [{ keyId: KEY_ID, alg: 'HS256', secret: new TextEncoder().encode(SECRET) }];
    const result = verifyChain(tampered, trusted, defaultAuditSignatureVerifier);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.breakAt).toBe(1);
    }
  });

  it('verifies an RS256-signed chain with PEM trust', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privJwk = privateKey.export({ format: 'jwk' }) as JsonWebKey;
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

    const store = new MemoryAuditStore();
    const signer = new Rs256AuditSigner(privJwk, 'rsa-prod');
    const logger = { warn: () => undefined };
    const writer = new SkillAuditWriter(store, signer, logger, undefined, { subjectMode: 'plain' });

    await writer.writeAuthorityPass(fakeCtx);
    await writer.writeHttpCallSuccess(fakeCtx, { status: 200, output: { ok: true } });

    const records = await store.read();
    expect(records.every((r) => r.signatureAlg === 'RS256')).toBe(true);
    expect(records.every((r) => r.signatureKeyId === 'rsa-prod')).toBe(true);

    const trusted: AuditTrustedKey[] = [{ keyId: 'rsa-prod', alg: 'RS256', publicKeyPem: pubPem }];
    expect(verifyChain(records, trusted, defaultAuditSignatureVerifier).ok).toBe(true);
  });
});
