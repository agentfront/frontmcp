// file: libs/adapters/src/skills/audit/__tests__/audit-signer.spec.ts

import { generateRsaKeyPair } from '@frontmcp/utils';

import {
  canonicalizeRecordForSigning,
  linkRecord,
  type AuditTrustedKey,
  type SkillAuditPartialRecord,
} from '../audit-chain';
import { type SkillAuditRecord } from '../audit-record.types';
import { defaultAuditSignatureVerifier, Hs256AuditSigner, Rs256AuditSigner } from '../audit-signer';

// Tests use the @frontmcp/utils key-pair generator (not node:crypto directly)
// per CLAUDE.md. We export PEMs from the KeyObjects so the verifier path
// exercises both PEM and JWK trust-list configurations.
function generateRsaTestKeys(): { privJwk: JsonWebKey; pubJwk: JsonWebKey; pubPem: string } {
  const { privateKey, publicKey, publicJwk } = generateRsaKeyPair(2048);
  const privJwk = privateKey.export({ format: 'jwk' }) as JsonWebKey;
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  return { privJwk, pubJwk: publicJwk as unknown as JsonWebKey, pubPem };
}

function makePartial(): SkillAuditPartialRecord {
  return {
    id: 'id-1',
    sequence: 1,
    timestamp: '2026-05-05T12:00:00.000Z',
    subject: 'user-1',
    skillId: 'billing',
    actionId: 'createInvoice',
    bundleId: 'acme:prod',
    bundleVersion: '1.0.0',
    phase: 'authority-check-pass',
    inputHash: 'a'.repeat(64),
  };
}

describe('Hs256AuditSigner', () => {
  it('rejects empty secrets', () => {
    expect(() => new Hs256AuditSigner('', 'k')).toThrow(/non-empty/);
    expect(() => new Hs256AuditSigner(new Uint8Array(0), 'k')).toThrow(/non-empty/);
  });

  it('rejects empty keyIds', () => {
    expect(() => new Hs256AuditSigner('ok', '')).toThrow(/keyId/);
  });

  it('round-trips: sign + verify', () => {
    const signer = new Hs256AuditSigner('top-secret', 'audit-1');
    const linked = linkRecord(undefined, makePartial());
    const sig = signer.sign(linked);
    expect(sig.alg).toBe('HS256');
    expect(sig.keyId).toBe('audit-1');
    expect(sig.signature.length).toBeGreaterThan(0);

    const rec: SkillAuditRecord = {
      ...linked,
      signature: sig.signature,
      signatureKeyId: sig.keyId,
      signatureAlg: sig.alg,
    };
    const trusted: AuditTrustedKey[] = [
      { keyId: 'audit-1', alg: 'HS256', secret: new TextEncoder().encode('top-secret') },
    ];
    const ok = defaultAuditSignatureVerifier({
      alg: 'HS256',
      keyId: 'audit-1',
      data: new TextEncoder().encode(canonicalizeRecordForSigning(rec)),
      signatureBase64Url: rec.signature,
      trustedKeys: trusted,
    });
    expect(ok).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const signer = new Hs256AuditSigner('top-secret', 'audit-1');
    const linked = linkRecord(undefined, makePartial());
    const sig = signer.sign(linked);
    const trusted: AuditTrustedKey[] = [
      { keyId: 'audit-1', alg: 'HS256', secret: new TextEncoder().encode('top-secret') },
    ];
    const ok = defaultAuditSignatureVerifier({
      alg: 'HS256',
      keyId: 'audit-1',
      data: new TextEncoder().encode(
        canonicalizeRecordForSigning({ ...linked, signature: '', signatureKeyId: 'audit-1', signatureAlg: 'HS256' }),
      ),
      signatureBase64Url: sig.signature.slice(0, -2) + 'AA',
      trustedKeys: trusted,
    });
    expect(ok).toBe(false);
  });

  it('rejects a wrong-key verifier', () => {
    const signer = new Hs256AuditSigner('top-secret', 'audit-1');
    const linked = linkRecord(undefined, makePartial());
    const sig = signer.sign(linked);
    const trusted: AuditTrustedKey[] = [{ keyId: 'audit-1', alg: 'HS256', secret: new TextEncoder().encode('OTHER') }];
    const rec = { ...linked, signature: sig.signature, signatureKeyId: 'audit-1', signatureAlg: 'HS256' as const };
    const ok = defaultAuditSignatureVerifier({
      alg: 'HS256',
      keyId: 'audit-1',
      data: new TextEncoder().encode(canonicalizeRecordForSigning(rec)),
      signatureBase64Url: rec.signature,
      trustedKeys: trusted,
    });
    expect(ok).toBe(false);
  });

  it('accepts Uint8Array secrets', () => {
    const secretBytes = new TextEncoder().encode('secret');
    const signer = new Hs256AuditSigner(secretBytes, 'audit-1');
    const linked = linkRecord(undefined, makePartial());
    expect(() => signer.sign(linked)).not.toThrow();
  });
});

describe('Rs256AuditSigner', () => {
  it('rejects empty keyIds', () => {
    const { privJwk } = generateRsaTestKeys();
    expect(() => new Rs256AuditSigner(privJwk, '')).toThrow(/keyId/);
  });

  it('rejects non-object jwks', () => {
    expect(() => new Rs256AuditSigner(null as unknown as JsonWebKey, 'k')).toThrow(/JWK/);
  });

  it('rejects non-RSA JWKs', () => {
    const ec = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' } as JsonWebKey;
    expect(() => new Rs256AuditSigner(ec, 'k')).toThrow(/kty must be "RSA"/);
  });

  it('rejects RSA JWKs missing required components (n, e, or d)', () => {
    const { privJwk } = generateRsaTestKeys();
    // Strip each required component in turn — the constructor must fail
    // fast at config time rather than deferring to the first sign() call.
    expect(() => new Rs256AuditSigner({ ...privJwk, n: undefined } as JsonWebKey, 'k')).toThrow(
      /must include `n`, `e`, and `d`/,
    );
    expect(() => new Rs256AuditSigner({ ...privJwk, e: undefined } as JsonWebKey, 'k')).toThrow(
      /must include `n`, `e`, and `d`/,
    );
    expect(() => new Rs256AuditSigner({ ...privJwk, d: undefined } as JsonWebKey, 'k')).toThrow(
      /must include `n`, `e`, and `d`/,
    );
  });

  it('round-trips: sign + verify with PEM public key', () => {
    const { privJwk, pubPem } = generateRsaTestKeys();

    const signer = new Rs256AuditSigner(privJwk, 'rsa-1');
    const linked = linkRecord(undefined, makePartial());
    const sig = signer.sign(linked);
    expect(sig.alg).toBe('RS256');
    expect(sig.keyId).toBe('rsa-1');
    expect(sig.signature.length).toBeGreaterThan(0);

    const rec: SkillAuditRecord = {
      ...linked,
      signature: sig.signature,
      signatureKeyId: sig.keyId,
      signatureAlg: sig.alg,
    };
    const trusted: AuditTrustedKey[] = [{ keyId: 'rsa-1', alg: 'RS256', publicKeyPem: pubPem }];
    const ok = defaultAuditSignatureVerifier({
      alg: 'RS256',
      keyId: 'rsa-1',
      data: new TextEncoder().encode(canonicalizeRecordForSigning(rec)),
      signatureBase64Url: rec.signature,
      trustedKeys: trusted,
    });
    expect(ok).toBe(true);
  });

  it('round-trips with public JWK trust', () => {
    const { privJwk, pubJwk } = generateRsaTestKeys();

    const signer = new Rs256AuditSigner(privJwk, 'rsa-2');
    const linked = linkRecord(undefined, makePartial());
    const sig = signer.sign(linked);
    const rec: SkillAuditRecord = {
      ...linked,
      signature: sig.signature,
      signatureKeyId: sig.keyId,
      signatureAlg: sig.alg,
    };
    const trusted: AuditTrustedKey[] = [{ keyId: 'rsa-2', alg: 'RS256', publicJwk: pubJwk }];
    const ok = defaultAuditSignatureVerifier({
      alg: 'RS256',
      keyId: 'rsa-2',
      data: new TextEncoder().encode(canonicalizeRecordForSigning(rec)),
      signatureBase64Url: rec.signature,
      trustedKeys: trusted,
    });
    expect(ok).toBe(true);
  });
});

describe('defaultAuditSignatureVerifier', () => {
  it('returns false when no trusted key matches the (keyId, alg) pair', () => {
    const ok = defaultAuditSignatureVerifier({
      alg: 'HS256',
      keyId: 'unknown-key',
      data: new Uint8Array(),
      signatureBase64Url: '',
      trustedKeys: [],
    });
    expect(ok).toBe(false);
  });

  it('returns false for an unsupported algorithm', () => {
    // Cast through `as never` to bypass the TS exhaustiveness check — the
    // verifier's final fallthrough path must still return false (not throw)
    // if a future signer alg lands on the wire without a verifier update.
    const ok = defaultAuditSignatureVerifier({
      alg: 'UNSUPPORTED_ALG' as never,
      keyId: 'k',
      data: new Uint8Array(),
      signatureBase64Url: '',
      trustedKeys: [{ keyId: 'k', alg: 'UNSUPPORTED_ALG' as never }],
    });
    expect(ok).toBe(false);
  });

  it('returns false when RS256 trusted key has no public material', () => {
    const trusted: AuditTrustedKey[] = [{ keyId: 'rsa-x', alg: 'RS256' }];
    const ok = defaultAuditSignatureVerifier({
      alg: 'RS256',
      keyId: 'rsa-x',
      data: new Uint8Array(),
      signatureBase64Url: 'AAA',
      trustedKeys: trusted,
    });
    expect(ok).toBe(false);
  });

  it('returns false when HS256 trusted key has no secret', () => {
    const trusted: AuditTrustedKey[] = [{ keyId: 'hs-x', alg: 'HS256' }];
    const ok = defaultAuditSignatureVerifier({
      alg: 'HS256',
      keyId: 'hs-x',
      data: new Uint8Array(),
      signatureBase64Url: 'AAA',
      trustedKeys: trusted,
    });
    expect(ok).toBe(false);
  });
});
