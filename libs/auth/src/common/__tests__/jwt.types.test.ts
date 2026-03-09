/**
 * JWT Types Schema Tests
 *
 * Tests the Zod schemas for JWK Parameters, JWK, and JSON Web Key Set.
 * These schemas contain runtime validation logic.
 */
import { jwkParametersSchema, jwkSchema, jsonWebKeySetSchema } from '../jwt.types';

// ============================================
// jwkParametersSchema
// ============================================

describe('jwkParametersSchema', () => {
  it('should accept an empty object (all fields are optional)', () => {
    const result = jwkParametersSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept a valid JWK Parameters object', () => {
    const result = jwkParametersSchema.safeParse({
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
      kid: 'key-id-1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kty).toBe('RSA');
      expect(result.data.alg).toBe('RS256');
      expect(result.data.use).toBe('sig');
      expect(result.data.kid).toBe('key-id-1');
    }
  });

  it('should accept key_ops as an array of strings', () => {
    const result = jwkParametersSchema.safeParse({
      key_ops: ['sign', 'verify'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.key_ops).toEqual(['sign', 'verify']);
    }
  });

  it('should accept ext as a boolean', () => {
    const result = jwkParametersSchema.safeParse({ ext: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ext).toBe(true);
    }
  });

  it('should accept x5c as an array of strings', () => {
    const result = jwkParametersSchema.safeParse({
      x5c: ['MIIB...', 'MIIC...'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.x5c).toEqual(['MIIB...', 'MIIC...']);
    }
  });

  it('should accept x5t and x5t#S256 as strings', () => {
    const result = jwkParametersSchema.safeParse({
      x5t: 'thumbprint-sha1',
      'x5t#S256': 'thumbprint-sha256',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.x5t).toBe('thumbprint-sha1');
      expect(result.data['x5t#S256']).toBe('thumbprint-sha256');
    }
  });

  it('should accept x5u as a string', () => {
    const result = jwkParametersSchema.safeParse({
      x5u: 'https://example.com/cert',
    });
    expect(result.success).toBe(true);
  });

  it('should reject ext as a string', () => {
    const result = jwkParametersSchema.safeParse({ ext: 'yes' });
    expect(result.success).toBe(false);
  });

  it('should reject key_ops as a string instead of array', () => {
    const result = jwkParametersSchema.safeParse({ key_ops: 'sign' });
    expect(result.success).toBe(false);
  });

  it('should reject kty as a number', () => {
    const result = jwkParametersSchema.safeParse({ kty: 123 });
    expect(result.success).toBe(false);
  });
});

// ============================================
// jwkSchema
// ============================================

describe('jwkSchema', () => {
  it('should accept an empty object (all fields optional)', () => {
    const result = jwkSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept a full RSA public key', () => {
    const result = jwkSchema.safeParse({
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
      kid: 'rsa-key-1',
      n: 'modulus-value',
      e: 'AQAB',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kty).toBe('RSA');
      expect(result.data.n).toBe('modulus-value');
      expect(result.data.e).toBe('AQAB');
    }
  });

  it('should accept an RSA private key with CRT parameters', () => {
    const result = jwkSchema.safeParse({
      kty: 'RSA',
      n: 'modulus',
      e: 'AQAB',
      d: 'private-exponent',
      p: 'prime1',
      q: 'prime2',
      dp: 'dp-value',
      dq: 'dq-value',
      qi: 'qi-value',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.d).toBe('private-exponent');
      expect(result.data.dp).toBe('dp-value');
      expect(result.data.dq).toBe('dq-value');
      expect(result.data.qi).toBe('qi-value');
    }
  });

  it('should accept an EC public key', () => {
    const result = jwkSchema.safeParse({
      kty: 'EC',
      crv: 'P-256',
      x: 'x-coordinate',
      y: 'y-coordinate',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.crv).toBe('P-256');
      expect(result.data.x).toBe('x-coordinate');
      expect(result.data.y).toBe('y-coordinate');
    }
  });

  it('should accept an OKP key', () => {
    const result = jwkSchema.safeParse({
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'public-key-value',
    });
    expect(result.success).toBe(true);
  });

  it('should accept an oct (symmetric) key', () => {
    const result = jwkSchema.safeParse({
      kty: 'oct',
      k: 'key-value-base64url',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.k).toBe('key-value-base64url');
    }
  });

  it('should accept AKP key with pub and priv', () => {
    const result = jwkSchema.safeParse({
      pub: 'public-key',
      priv: 'private-key',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pub).toBe('public-key');
      expect(result.data.priv).toBe('private-key');
    }
  });

  it('should inherit JWK Parameters fields', () => {
    const result = jwkSchema.safeParse({
      kty: 'RSA',
      alg: 'RS256',
      kid: 'my-key',
      use: 'sig',
      key_ops: ['verify'],
      ext: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alg).toBe('RS256');
      expect(result.data.kid).toBe('my-key');
      expect(result.data.key_ops).toEqual(['verify']);
      expect(result.data.ext).toBe(false);
    }
  });

  it('should reject non-string values for key components', () => {
    const result = jwkSchema.safeParse({ n: 12345 });
    expect(result.success).toBe(false);
  });
});

// ============================================
// jsonWebKeySetSchema
// ============================================

describe('jsonWebKeySetSchema', () => {
  it('should accept a valid JWKS with empty keys array', () => {
    const result = jsonWebKeySetSchema.safeParse({ keys: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keys).toEqual([]);
    }
  });

  it('should accept a JWKS with multiple keys', () => {
    const result = jsonWebKeySetSchema.safeParse({
      keys: [
        { kty: 'RSA', alg: 'RS256', n: 'modulus', e: 'AQAB', kid: 'key-1' },
        { kty: 'EC', crv: 'P-256', x: 'x-val', y: 'y-val', kid: 'key-2' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keys).toHaveLength(2);
      expect(result.data.keys[0].kid).toBe('key-1');
      expect(result.data.keys[1].kid).toBe('key-2');
    }
  });

  it('should reject missing keys property', () => {
    const result = jsonWebKeySetSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject keys as a non-array', () => {
    const result = jsonWebKeySetSchema.safeParse({ keys: 'not-array' });
    expect(result.success).toBe(false);
  });

  it('should reject keys array with invalid JWK entries', () => {
    const result = jsonWebKeySetSchema.safeParse({
      keys: [{ n: 12345 }], // n must be string
    });
    expect(result.success).toBe(false);
  });
});
