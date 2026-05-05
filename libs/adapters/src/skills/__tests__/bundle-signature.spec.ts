import { generateKeyPairSync, sign } from 'node:crypto';

import type { ResolvedBundle } from '../bundle/bundle.types';
import { bundleDigest, canonicalize, verifyBundleSignature } from '../security/bundle-signature';

function bytesToBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeBundle(): ResolvedBundle {
  return {
    schemaVersion: 1,
    bundleId: 'acme:prod',
    version: '1',
    generatedAt: '2026-05-01T12:00:00.000Z',
    sourceDigest: 'a'.repeat(64),
    services: [{ id: 'svc', baseUrl: 'https://example.com' }],
    authBindings: { def: { kind: 'none' } },
    skills: [],
    operations: {},
  };
}

function signBundleRsa(bundle: ResolvedBundle): { keyPem: string; integrity: ResolvedBundle['integrity'] } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const { integrity: _drop, ...rest } = bundle;
  void _drop;
  const canonical = canonicalize(rest);
  const sig = sign('sha256', Buffer.from(canonical, 'utf8'), privateKey);
  return {
    keyPem: publicKey,
    integrity: {
      alg: 'RS256',
      keyId: 'key1',
      signature: bytesToBase64Url(sig),
      digest: bundleDigest(bundle),
    },
  };
}

function signBundleEd25519(bundle: ResolvedBundle): { keyPem: string; integrity: ResolvedBundle['integrity'] } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const { integrity: _drop, ...rest } = bundle;
  void _drop;
  const canonical = canonicalize(rest);
  const sig = sign(null, Buffer.from(canonical, 'utf8'), privateKey);
  return {
    keyPem: publicKey,
    integrity: {
      alg: 'EdDSA',
      keyId: 'key2',
      signature: bytesToBase64Url(sig),
      digest: bundleDigest(bundle),
    },
  };
}

describe('canonicalize', () => {
  it('sorts keys deterministically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });
  it('handles arrays in order', () => {
    expect(canonicalize([1, 2, 3])).toBe('[1,2,3]');
  });
  it('handles primitives', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize('x')).toBe('"x"');
    expect(canonicalize(42)).toBe('42');
  });
});

describe('bundleDigest', () => {
  it('does not include integrity in the digest', () => {
    const a = makeBundle();
    const b = { ...a, integrity: { alg: 'RS256' as const, keyId: 'k', signature: 'x', digest: 'y' } };
    expect(bundleDigest(a)).toBe(bundleDigest(b));
  });

  it('changes when bundle content changes', () => {
    const a = makeBundle();
    const b = { ...a, version: '2' };
    expect(bundleDigest(a)).not.toBe(bundleDigest(b));
  });
});

describe('verifyBundleSignature — RS256', () => {
  it('accepts a valid signature', () => {
    const bundle = makeBundle();
    const { keyPem, integrity } = signBundleRsa(bundle);
    bundle.integrity = integrity;
    const result = verifyBundleSignature(bundle, [{ keyId: 'key1', alg: 'RS256', publicKeyPem: keyPem }]);
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered bundle (digest mismatch)', () => {
    const bundle = makeBundle();
    const { keyPem, integrity } = signBundleRsa(bundle);
    bundle.integrity = integrity;
    // Tamper after signing
    bundle.version = 'TAMPERED';
    const result = verifyBundleSignature(bundle, [{ keyId: 'key1', alg: 'RS256', publicKeyPem: keyPem }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/digest mismatch/);
  });

  it('rejects unknown keyId', () => {
    const bundle = makeBundle();
    const { keyPem: _drop, integrity } = signBundleRsa(bundle);
    void _drop;
    bundle.integrity = integrity;
    const result = verifyBundleSignature(bundle, [{ keyId: 'OTHER', alg: 'RS256', publicKeyPem: 'x' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown signing keyId/);
  });

  it('rejects when alg does not match key alg', () => {
    const bundle = makeBundle();
    const { keyPem, integrity } = signBundleRsa(bundle);
    bundle.integrity = integrity;
    const result = verifyBundleSignature(bundle, [{ keyId: 'key1', alg: 'EdDSA', publicKeyPem: keyPem }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/alg=/);
  });

  it('rejects bundles missing integrity envelope', () => {
    const bundle = makeBundle();
    const result = verifyBundleSignature(bundle, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/missing integrity/);
  });

  it('rejects when signature does not verify', () => {
    const bundle = makeBundle();
    const { keyPem } = signBundleRsa(bundle);
    bundle.integrity = {
      alg: 'RS256',
      keyId: 'key1',
      signature: 'A'.repeat(8),
      digest: bundleDigest(bundle),
    };
    const result = verifyBundleSignature(bundle, [{ keyId: 'key1', alg: 'RS256', publicKeyPem: keyPem }]);
    expect(result.ok).toBe(false);
  });

  it('handles malformed public key PEM', () => {
    const bundle = makeBundle();
    bundle.integrity = { alg: 'RS256', keyId: 'k', signature: 'x', digest: bundleDigest(bundle) };
    const result = verifyBundleSignature(bundle, [{ keyId: 'k', alg: 'RS256', publicKeyPem: 'not-a-pem' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/parse public key/);
  });
});

describe('verifyBundleSignature telemetry', () => {
  function makeFakeTelemetry(): {
    telemetry: {
      createCounter: (n: string, d?: string) => { inc: (by?: number, attrs?: Record<string, string>) => void };
    };
    counterCalls: { name: string; by: number; attributes: Record<string, string> }[];
  } {
    const counterCalls: { name: string; by: number; attributes: Record<string, string> }[] = [];
    return {
      counterCalls,
      telemetry: {
        createCounter(name) {
          return {
            inc(by = 1, attributes = {}) {
              counterCalls.push({ name, by, attributes });
            },
          };
        },
      },
    };
  }

  it('records verifications_total{status=ok} on success and skips the failures counter', () => {
    const { telemetry, counterCalls } = makeFakeTelemetry();
    const bundle = makeBundle();
    const { keyPem, integrity } = signBundleRsa(bundle);
    bundle.integrity = integrity;
    const result = verifyBundleSignature(bundle, [{ keyId: 'key1', alg: 'RS256', publicKeyPem: keyPem }], telemetry);
    expect(result.ok).toBe(true);
    const failures = counterCalls.filter((c) => c.name === 'frontmcp_skills_signature_failures_total');
    const verifications = counterCalls.filter((c) => c.name === 'frontmcp_skills_signature_verifications_total');
    expect(failures).toHaveLength(0);
    expect(verifications).toHaveLength(1);
    expect(verifications[0].attributes['status']).toBe('ok');
  });

  it('increments with reason=missing_integrity when integrity is absent', () => {
    const { telemetry, counterCalls } = makeFakeTelemetry();
    verifyBundleSignature(makeBundle(), [], telemetry);
    const failures = counterCalls.filter((c) => c.name === 'frontmcp_skills_signature_failures_total');
    const verifications = counterCalls.filter((c) => c.name === 'frontmcp_skills_signature_verifications_total');
    expect(failures).toHaveLength(1);
    expect(failures[0].attributes['reason']).toBe('missing_integrity');
    expect(verifications).toHaveLength(1);
    expect(verifications[0].attributes['status']).toBe('error');
  });

  it('increments with reason=digest_mismatch on tampered bundle', () => {
    const { telemetry, counterCalls } = makeFakeTelemetry();
    const bundle = makeBundle();
    const { keyPem, integrity } = signBundleRsa(bundle);
    bundle.integrity = integrity;
    bundle.version = 'TAMPERED';
    verifyBundleSignature(bundle, [{ keyId: 'key1', alg: 'RS256', publicKeyPem: keyPem }], telemetry);
    const failures = counterCalls.filter((c) => c.name === 'frontmcp_skills_signature_failures_total');
    expect(failures[0].attributes['reason']).toBe('digest_mismatch');
  });

  it('increments with reason=unknown_key_id when keyId is unknown', () => {
    const { telemetry, counterCalls } = makeFakeTelemetry();
    const bundle = makeBundle();
    const { integrity } = signBundleRsa(bundle);
    bundle.integrity = integrity;
    verifyBundleSignature(bundle, [{ keyId: 'OTHER', alg: 'RS256', publicKeyPem: 'x' }], telemetry);
    const failures = counterCalls.filter((c) => c.name === 'frontmcp_skills_signature_failures_total');
    expect(failures[0].attributes['reason']).toBe('unknown_key_id');
  });

  it('increments with reason=alg_mismatch on alg disagreement', () => {
    const { telemetry, counterCalls } = makeFakeTelemetry();
    const bundle = makeBundle();
    const { keyPem, integrity } = signBundleRsa(bundle);
    bundle.integrity = integrity;
    verifyBundleSignature(bundle, [{ keyId: 'key1', alg: 'EdDSA', publicKeyPem: keyPem }], telemetry);
    const failures = counterCalls.filter((c) => c.name === 'frontmcp_skills_signature_failures_total');
    expect(failures[0].attributes['reason']).toBe('alg_mismatch');
  });

  it('increments with reason=malformed_public_key on PEM parse failure', () => {
    const { telemetry, counterCalls } = makeFakeTelemetry();
    const bundle = makeBundle();
    bundle.integrity = { alg: 'RS256', keyId: 'k', signature: 'x', digest: bundleDigest(bundle) };
    verifyBundleSignature(bundle, [{ keyId: 'k', alg: 'RS256', publicKeyPem: 'not-a-pem' }], telemetry);
    const failures = counterCalls.filter((c) => c.name === 'frontmcp_skills_signature_failures_total');
    expect(failures[0].attributes['reason']).toBe('malformed_public_key');
  });

  it('increments with reason=verify_failed when signature does not verify', () => {
    const { telemetry, counterCalls } = makeFakeTelemetry();
    const bundle = makeBundle();
    const { keyPem } = signBundleRsa(bundle);
    bundle.integrity = {
      alg: 'RS256',
      keyId: 'key1',
      // 256-byte signature with all zeroes — well-formed length but invalid bytes.
      signature: 'A'.repeat(342),
      digest: bundleDigest(bundle),
    };
    verifyBundleSignature(bundle, [{ keyId: 'key1', alg: 'RS256', publicKeyPem: keyPem }], telemetry);
    const failures = counterCalls.filter((c) => c.name === 'frontmcp_skills_signature_failures_total');
    expect(failures).toHaveLength(1);
    // Either verify_failed or verify_threw is acceptable depending on the
    // node-crypto implementation — both indicate a signature rejection and
    // both are low-cardinality.
    expect(['verify_failed', 'verify_threw']).toContain(failures[0].attributes['reason']);
  });

  it('omitting telemetry leaves the function dependency-free', () => {
    const bundle = makeBundle();
    expect(verifyBundleSignature(bundle, []).ok).toBe(false);
  });
});

describe('verifyBundleSignature — EdDSA / Ed25519', () => {
  it('accepts a valid signature', () => {
    const bundle = makeBundle();
    const { keyPem, integrity } = signBundleEd25519(bundle);
    bundle.integrity = integrity;
    const result = verifyBundleSignature(bundle, [{ keyId: 'key2', alg: 'EdDSA', publicKeyPem: keyPem }]);
    expect(result.ok).toBe(true);
  });

  it('returns ok:false when node verify throws (e.g. malformed signature bytes)', () => {
    const bundle = makeBundle();
    const { keyPem } = signBundleEd25519(bundle);
    // Use mismatched alg (RSA bytes against an Ed25519 key) — node verify
    // throws synchronously when the signature length is wrong for Ed25519.
    bundle.integrity = {
      alg: 'EdDSA',
      keyId: 'key2',
      // 5-byte garbage signature is the wrong length for Ed25519 (64 bytes).
      signature: 'AAAAA',
      digest: bundleDigest(bundle),
    };
    const result = verifyBundleSignature(bundle, [{ keyId: 'key2', alg: 'EdDSA', publicKeyPem: keyPem }]);
    expect(result.ok).toBe(false);
  });
});
