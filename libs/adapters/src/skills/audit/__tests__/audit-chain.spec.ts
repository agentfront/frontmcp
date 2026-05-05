// file: libs/adapters/src/skills/audit/__tests__/audit-chain.spec.ts

import { sha256Hex } from '@frontmcp/utils';

import { canonicalize } from '../../security/bundle-signature';
import {
  canonicalizeRecordForSigning,
  linkRecord,
  nextPrevHash,
  verifyChain,
  type AuditSignatureVerifier,
  type AuditTrustedKey,
  type SkillAuditPartialRecord,
} from '../audit-chain';
import { SKILL_AUDIT_GENESIS_PREV_HASH, type SkillAuditRecord } from '../audit-record.types';
import { defaultAuditSignatureVerifier, Hs256AuditSigner } from '../audit-signer';

const SECRET = 'unit-test-secret-not-for-production';
const KEY_ID = 'test-key';

function makePartial(seq: number, overrides: Partial<SkillAuditPartialRecord> = {}): SkillAuditPartialRecord {
  return {
    id: `id-${seq}`,
    sequence: seq,
    timestamp: '2026-05-05T12:00:00.000Z',
    subject: 'user-1',
    skillId: 'billing',
    actionId: 'createInvoice',
    bundleId: 'acme:prod',
    bundleVersion: '1.0.0',
    phase: 'authority-check-pass',
    inputHash: sha256Hex(canonicalize({ amount: 100 })),
    ...overrides,
  };
}

function buildSignedChain(count: number): { records: SkillAuditRecord[]; trusted: AuditTrustedKey[] } {
  const signer = new Hs256AuditSigner(SECRET, KEY_ID);
  const records: SkillAuditRecord[] = [];
  let prev: SkillAuditRecord | undefined;
  for (let i = 1; i <= count; i++) {
    const linked = linkRecord(prev, makePartial(i));
    const sig = signer.sign(linked);
    const rec: SkillAuditRecord = {
      ...linked,
      signature: sig.signature,
      signatureKeyId: sig.keyId,
      signatureAlg: sig.alg,
    };
    records.push(rec);
    prev = rec;
  }
  return {
    records,
    trusted: [{ keyId: KEY_ID, alg: 'HS256', secret: new TextEncoder().encode(SECRET) }],
  };
}

describe('audit-chain', () => {
  describe('canonicalizeRecordForSigning', () => {
    it('omits the signature field', () => {
      const partial = makePartial(1);
      const linked = linkRecord(undefined, partial);
      const rec: SkillAuditRecord = { ...linked, signature: 'AAA', signatureKeyId: KEY_ID, signatureAlg: 'HS256' };
      const canonical = canonicalizeRecordForSigning(rec);
      expect(canonical).not.toContain('"signature"');
      expect(canonical).toContain('"signatureKeyId"');
      expect(canonical).toContain('"signatureAlg"');
    });

    it('produces the same bytes regardless of object key insertion order', () => {
      const partial = makePartial(1);
      const linked = linkRecord(undefined, partial);
      const r1: SkillAuditRecord = {
        ...linked,
        signature: 'AAA',
        signatureKeyId: KEY_ID,
        signatureAlg: 'HS256',
      };
      // Build with a shuffled key order.
      const r2: SkillAuditRecord = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(r1).reverse())));
      expect(canonicalizeRecordForSigning(r1)).toBe(canonicalizeRecordForSigning(r2));
    });
  });

  describe('nextPrevHash', () => {
    it('returns the genesis sentinel for undefined prev', () => {
      expect(nextPrevHash(undefined)).toBe(SKILL_AUDIT_GENESIS_PREV_HASH);
      expect(SKILL_AUDIT_GENESIS_PREV_HASH).toMatch(/^0{64}$/);
    });

    it('returns sha256 of the canonicalized prev record (sans signature)', () => {
      const linked = linkRecord(undefined, makePartial(1));
      const rec: SkillAuditRecord = {
        ...linked,
        signature: 'AAA',
        signatureKeyId: KEY_ID,
        signatureAlg: 'HS256',
      };
      const expected = sha256Hex(canonicalizeRecordForSigning(rec));
      expect(nextPrevHash(rec)).toBe(expected);
    });
  });

  describe('linkRecord', () => {
    it('genesis record gets the all-zero prevHash', () => {
      const linked = linkRecord(undefined, makePartial(1));
      expect(linked.prevHash).toBe(SKILL_AUDIT_GENESIS_PREV_HASH);
    });

    it('linked record carries sha256 of prev', () => {
      const { records } = buildSignedChain(2);
      expect(records[0]!.prevHash).toBe(SKILL_AUDIT_GENESIS_PREV_HASH);
      expect(records[1]!.prevHash).toBe(sha256Hex(canonicalizeRecordForSigning(records[0]!)));
    });
  });

  describe('verifyChain', () => {
    it('returns ok for an empty chain', () => {
      const result = verifyChain([], [], defaultAuditSignatureVerifier);
      expect(result.ok).toBe(true);
    });

    it('returns ok for a clean signed chain', () => {
      const { records, trusted } = buildSignedChain(5);
      const result = verifyChain(records, trusted, defaultAuditSignatureVerifier);
      expect(result).toEqual({ ok: true, verified: 5 });
    });

    it('detects tampering with a record body', () => {
      const { records, trusted } = buildSignedChain(3);
      // Tamper with record #2 — change the input hash.
      const tampered = [records[0]!, { ...records[1]!, inputHash: 'tampered' }, records[2]!];
      const result = verifyChain(tampered, trusted, defaultAuditSignatureVerifier);
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.breakAt).toBe(2);
        expect(result.reason).toMatch(/signature/i);
      }
    });

    it('detects a broken prevHash link (record reordering)', () => {
      const { records, trusted } = buildSignedChain(3);
      // Swap records 2 and 3 — sequences will be wrong.
      const reordered = [records[0]!, records[2]!, records[1]!];
      const result = verifyChain(reordered, trusted, defaultAuditSignatureVerifier);
      expect(result.ok).toBe(false);
    });

    it('detects a missing record in the middle (sequence gap)', () => {
      const { records, trusted } = buildSignedChain(3);
      const missing = [records[0]!, records[2]!];
      const result = verifyChain(missing, trusted, defaultAuditSignatureVerifier);
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.reason).toMatch(/sequence/i);
      }
    });

    it('rejects when the signing key is not in the trusted set', () => {
      const { records } = buildSignedChain(2);
      const wrongTrusted: AuditTrustedKey[] = [
        { keyId: 'other-key', alg: 'HS256', secret: new TextEncoder().encode(SECRET) },
      ];
      const result = verifyChain(records, wrongTrusted, defaultAuditSignatureVerifier);
      expect(result.ok).toBe(false);
    });

    it('uses a custom verifier when supplied', () => {
      const { records, trusted } = buildSignedChain(2);
      const calls: number[] = [];
      const customVerifier: AuditSignatureVerifier = (input) => {
        calls.push(1);
        return defaultAuditSignatureVerifier(input);
      };
      const result = verifyChain(records, trusted, customVerifier);
      expect(result.ok).toBe(true);
      expect(calls.length).toBe(2);
    });
  });
});
