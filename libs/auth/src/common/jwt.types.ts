import { z } from 'zod';
import { RawZodShape } from './zod-utils';

export interface JWKParameters {
  /** JWK "kty" (Key Type) Parameter */
  kty?: string;
  /**
   * JWK "alg" (Algorithm) Parameter
   *
   * @see {@link https://github.com/panva/jose/issues/210 Algorithm Key Requirements}
   */
  alg?: string;
  /** JWK "key_ops" (Key Operations) Parameter */
  key_ops?: string[];
  /** JWK "ext" (Extractable) Parameter */
  ext?: boolean;
  /** JWK "use" (Public Key Use) Parameter */
  use?: string;
  /** JWK "x5c" (X.509 Certificate Chain) Parameter */
  x5c?: string[];
  /** JWK "x5t" (X.509 Certificate SHA-1 Thumbprint) Parameter */
  x5t?: string;
  /** JWK "x5t#S256" (X.509 Certificate SHA-256 Thumbprint) Parameter */
  'x5t#S256'?: string;
  /** JWK "x5u" (X.509 URL) Parameter */
  x5u?: string;
  /** JWK "kid" (Key ID) Parameter */
  kid?: string;
}

export const jwkParametersSchema = z.object({
  kty: z.string().optional(),
  alg: z.string().optional(),
  key_ops: z.array(z.string()).optional(),
  ext: z.boolean().optional(),
  use: z.string().optional(),
  x5c: z.array(z.string()).optional(),
  x5t: z.string().optional(),
  'x5t#S256': z.string().optional(),
  x5u: z.string().optional(),
  kid: z.string().optional(),
} satisfies RawZodShape<JWKParameters>);

export interface JWK extends JWKParameters {
  /**
   * - EC JWK "crv" (Curve) Parameter
   * - OKP JWK "crv" (The Subtype of Key Pair) Parameter
   */
  crv?: string;
  /**
   * - Private RSA JWK "d" (Private Exponent) Parameter
   * - Private EC JWK "d" (ECC Private Key) Parameter
   * - Private OKP JWK "d" (The Private Key) Parameter
   */
  d?: string;
  /** Private RSA JWK "dp" (First Factor CRT Exponent) Parameter */
  dp?: string;
  /** Private RSA JWK "dq" (Second Factor CRT Exponent) Parameter */
  dq?: string;
  /** RSA JWK "e" (Exponent) Parameter */
  e?: string;
  /** Oct JWK "k" (Key Value) Parameter */
  k?: string;
  /** RSA JWK "n" (Modulus) Parameter */
  n?: string;
  /** Private RSA JWK "p" (First Prime Factor) Parameter */
  p?: string;
  /** Private RSA JWK "q" (Second Prime Factor) Parameter */
  q?: string;
  /** Private RSA JWK "qi" (First CRT Coefficient) Parameter */
  qi?: string;
  /**
   * - EC JWK "x" (X Coordinate) Parameter
   * - OKP JWK "x" (The public key) Parameter
   */
  x?: string;
  /** EC JWK "y" (Y Coordinate) Parameter */
  y?: string;
  /** AKP JWK "pub" (Public Key) Parameter */
  pub?: string;
  /** AKP JWK "priv" (Private key) Parameter */
  priv?: string;
}

export const jwkSchema: z.ZodType<JWK> = jwkParametersSchema.extend({
  crv: z.string().optional(),
  d: z.string().optional(),
  dp: z.string().optional(),
  dq: z.string().optional(),
  e: z.string().optional(),
  k: z.string().optional(),
  n: z.string().optional(),
  p: z.string().optional(),
  q: z.string().optional(),
  qi: z.string().optional(),
  x: z.string().optional(),
  y: z.string().optional(),
  pub: z.string().optional(),
  priv: z.string().optional(),
} satisfies RawZodShape<JWK, JWKParameters>);

export interface JSONWebKeySet {
  keys: JWK[];
}

export const jsonWebKeySetSchema = z.object({
  keys: z.array(jwkSchema),
} satisfies RawZodShape<JSONWebKeySet>);
