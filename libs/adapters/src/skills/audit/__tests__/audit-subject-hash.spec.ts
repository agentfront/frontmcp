import { bytesToHex, generateRsaKeyPair, hmacSha256 } from '@frontmcp/utils';

import { Hs256AuditSigner, Rs256AuditSigner, type SkillAuditSigner } from '../audit-signer';
import { MemoryAuditStore } from '../audit-store';
import { SkillAuditWriter, type SkillAuditLogger } from '../audit-writer';

const silentLogger: SkillAuditLogger = { warn: () => undefined };

function writeContext(subject: string) {
  return { subject, skillId: 'billing', actionId: 'refund', bundleId: 'acme', bundleVersion: '1', input: {} };
}

async function recordedSubject(
  signer: SkillAuditSigner,
  options: ConstructorParameters<typeof SkillAuditWriter>[4] = {},
  logger: SkillAuditLogger = silentLogger,
): Promise<string> {
  const store = new MemoryAuditStore();
  const writer = new SkillAuditWriter(store, signer, logger, undefined, options);
  await writer.writeAuthorityPass(writeContext('nour'));
  const [record] = await store.read();
  if (!record) throw new Error('no record was written');
  return record.subject;
}

/** The key 1.9.4 derived when no subjectHashSecret was given: the keyId's bytes, repeated. */
function hashFromPublicKeyId(keyId: string, subject: string): string {
  const seed = new TextEncoder().encode(`frontmcp:audit:subject:${keyId}`);
  const key = new Uint8Array(32).map((_, index) => seed[index % seed.length] ?? 0);
  return `hashed:${bytesToHex(hmacSha256(key, new TextEncoder().encode(subject))).slice(0, 32)}`;
}

describe('the default subject hash', () => {
  it('cannot be recomputed from the keyId written into every record', async () => {
    const subject = await recordedSubject(new Hs256AuditSigner('signer-secret-a', 'audit-2026'));

    expect(subject).toMatch(/^hashed:[0-9a-f]{32}$/);
    expect(subject).not.toBe(hashFromPublicKeyId('audit-2026', 'nour'));
  });

  it("changes with the signer's secret", async () => {
    const first = await recordedSubject(new Hs256AuditSigner('signer-secret-a', 'audit-2026'));
    const second = await recordedSubject(new Hs256AuditSigner('signer-secret-b', 'audit-2026'));

    expect(first).not.toBe(second);
  });

  it('is derived from an RS256 private key too', async () => {
    const privateJwk = generateRsaKeyPair().privateKey.export({ format: 'jwk' }) as JsonWebKey;

    const subject = await recordedSubject(new Rs256AuditSigner(privateJwk, 'audit-2026'));

    expect(subject).toMatch(/^hashed:[0-9a-f]{32}$/);
    expect(subject).not.toBe(hashFromPublicKeyId('audit-2026', 'nour'));
  });

  it('uses subjectHashSecret when it is given', async () => {
    const secret = new TextEncoder().encode('host-managed-subject-key');
    const first = await recordedSubject(new Hs256AuditSigner('signer-secret-a', 'audit-2026'), {
      subjectHashSecret: secret,
    });
    const second = await recordedSubject(new Hs256AuditSigner('signer-secret-b', 'audit-2026'), {
      subjectHashSecret: secret,
    });

    expect(first).toBe(second);
  });

  it('omits the subject, with a warning, for a signer whose key cannot be derived from', async () => {
    const warnings: unknown[][] = [];
    const keylessSigner: SkillAuditSigner = {
      sign: () => ({ signature: 'sig', keyId: 'hsm-key', alg: 'RS256' }),
      getKeyId: () => 'hsm-key',
      getAlg: () => 'RS256',
    };

    const subject = await recordedSubject(keylessSigner, {}, { warn: (...args: unknown[]) => warnings.push(args) });

    expect(subject).toBe('redacted');
    expect(JSON.stringify(warnings)).toMatch(/subjectHashSecret/);
  });
});
