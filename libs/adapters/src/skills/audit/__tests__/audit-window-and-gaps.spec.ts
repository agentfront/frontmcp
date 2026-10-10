import { verifyChain, type AuditTrustedKey } from '../audit-chain';
import { defaultAuditSignatureVerifier, Hs256AuditSigner, type SkillAuditSigner } from '../audit-signer';
import { MemoryAuditStore } from '../audit-store';
import { SkillAuditWriter } from '../audit-writer';

const SECRET = 'audit-window-secret';
const KEY_ID = 'audit-window';
const TRUSTED: AuditTrustedKey[] = [{ keyId: KEY_ID, alg: 'HS256', secret: new TextEncoder().encode(SECRET) }];
const silentLogger = { warn: () => undefined };

function writeContext(actionId: string) {
  return { subject: 'nour', skillId: 'billing', actionId, bundleId: 'acme', bundleVersion: '1', input: {} };
}

async function chainOf(length: number): Promise<MemoryAuditStore> {
  const store = new MemoryAuditStore();
  const writer = new SkillAuditWriter(store, new Hs256AuditSigner(SECRET, KEY_ID), silentLogger);
  for (let index = 0; index < length; index++) await writer.writeAuthorityPass(writeContext(`action-${index}`));
  return store;
}

describe('verifyChain on a window of the chain', () => {
  it('verifies records read from the middle of the chain against the record before them', async () => {
    const store = await chainOf(6);
    const [previous, ...window] = await store.read({ from: 3, limit: 4 });

    const result = verifyChain(window, TRUSTED, defaultAuditSignatureVerifier, { previous });

    expect(result).toEqual({ ok: true, verified: 3 });
  });

  it('reports a window whose previous record is not the one before it', async () => {
    const store = await chainOf(6);
    const [unrelated] = await store.read({ from: 1, limit: 1 });
    const window = await store.read({ from: 4, limit: 3 });

    const result = verifyChain(window, TRUSTED, defaultAuditSignatureVerifier, { previous: unrelated });

    expect(result).toEqual(expect.objectContaining({ ok: false, breakAt: 4 }));
  });

  it('still reports a chain whose first records were removed', async () => {
    const store = await chainOf(4);
    const withoutHead = await store.read({ from: 2 });

    expect(verifyChain(withoutHead, TRUSTED, defaultAuditSignatureVerifier).ok).toBe(false);
  });
});

describe('MemoryAuditStore after a failed write', () => {
  it('gives the unused sequence number back, so the chain has no gap', async () => {
    const store = new MemoryAuditStore();
    const signer = new Hs256AuditSigner(SECRET, KEY_ID);
    let failNextSign = false;
    const flakySigner: SkillAuditSigner = {
      sign: (record) => {
        if (failNextSign) {
          failNextSign = false;
          throw new Error('signer unavailable');
        }
        return signer.sign(record);
      },
      getKeyId: () => KEY_ID,
      getAlg: () => 'HS256',
    };
    const writer = new SkillAuditWriter(store, flakySigner, silentLogger);

    await writer.writeAuthorityPass(writeContext('first'));
    failNextSign = true;
    await writer.writeAuthorityPass(writeContext('lost'));
    await writer.writeAuthorityPass(writeContext('third'));

    expect(verifyChain(await store.read(), TRUSTED, defaultAuditSignatureVerifier)).toEqual({ ok: true, verified: 2 });
  });
});
