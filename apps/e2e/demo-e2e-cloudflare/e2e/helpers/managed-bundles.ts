import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';

import {
  bundleDigest,
  canonicalize,
  PUSH_BODY_DIGEST_CLAIM,
  pushBodyDigest,
  type OperationDescriptor,
  type ResolvedBundle,
  type SignatureKey,
} from '@frontmcp/adapters/skills';
import { generateRsaKeyPair, randomUUID, rsaSignBase64Url } from '@frontmcp/utils';

export const BUNDLE_ISSUER = 'https://bundles.example';
export const BUNDLE_URL = `${BUNDLE_ISSUER}/v1/bundles/e2e-managed`;
export const JWKS_URL = `${BUNDLE_ISSUER}/.well-known/jwks.json`;
export const BUNDLE_AUDIENCE = 'e2e:managed';
export const BILLING_API_URL = 'https://billing.example';

const SIGNING_KEY_ID = 'e2e-bundle-signing';

/** The bundle server's token issuer: its JWKS, the pinned pull token, and the short-lived tokens a push carries. */
export class BundleTokenIssuer {
  private constructor(
    readonly jwks: { keys: JWK[] },
    private readonly kid: string,
    private readonly privateKey: CryptoKey,
  ) {}

  static async create(kid: string): Promise<BundleTokenIssuer> {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
    return new BundleTokenIssuer({ keys: [jwk] }, kid, privateKey);
  }

  pullToken(): Promise<string> {
    return this.sign({}, '1h');
  }

  pushToken(claims: JWTPayload = {}): Promise<string> {
    return this.sign({ jti: randomUUID(), ...claims }, '5m');
  }

  /** A push token bound to `body`, the exact JSON it is pushed with, by its `body_sha256` claim. */
  pushTokenFor(body: string): Promise<string> {
    return this.pushToken({ [PUSH_BODY_DIGEST_CLAIM]: pushBodyDigest(body) });
  }

  private sign(claims: JWTPayload, expiresIn: string): Promise<string> {
    return new SignJWT({ iss: BUNDLE_ISSUER, aud: BUNDLE_AUDIENCE, sub: 'cf-managed-fixture', ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: this.kid })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.privateKey);
  }
}

/** Signs bundles with a key made for this run; the Worker trusts its public half. */
export class BundleSigner {
  private readonly keyPair = generateRsaKeyPair();

  get trustedKey(): SignatureKey {
    return {
      keyId: SIGNING_KEY_ID,
      alg: 'RS256',
      publicKeyPem: String(this.keyPair.publicKey.export({ type: 'spki', format: 'pem' })),
    };
  }

  sign(bundle: ResolvedBundle): ResolvedBundle {
    const { integrity: _unsigned, ...content } = bundle;
    const privateJwk = this.keyPair.privateKey.export({ format: 'jwk' });
    const signature = rsaSignBase64Url('RS256', new TextEncoder().encode(canonicalize(content)), privateJwk);
    return { ...content, integrity: { alg: 'RS256', keyId: SIGNING_KEY_ID, digest: bundleDigest(content), signature } };
  }
}

const createInvoiceOperation: OperationDescriptor = {
  operationId: 'createInvoice',
  serviceId: 'billing',
  httpMethod: 'POST',
  pathTemplate: '/v1/invoices',
  summary: 'Create an invoice for a customer',
  public: true,
  inputSchema: {
    type: 'object',
    properties: { customerId: { type: 'string' }, amount: { type: 'number' } },
    required: ['customerId', 'amount'],
  },
  outputSchema: {
    type: 'object',
    properties: { id: { type: 'string' }, status: { type: 'string' } },
    required: ['id', 'status'],
  },
  mapper: [
    { inputKey: 'customerId', type: 'body', key: 'customerId', required: true },
    { inputKey: 'amount', type: 'body', key: 'amount', required: true },
  ],
  authBindingRef: 'default',
};

export type BillingSkillId = 'invoices' | 'reports' | 'refunds';

const billingSkills: Record<BillingSkillId, ResolvedBundle['skills'][number]> = {
  invoices: {
    id: 'invoices',
    name: 'Invoices',
    description: 'Create billing invoices for customers.',
    instructions: '# Invoices\n\nCreate an invoice with createInvoice.',
    tags: ['billing'],
    operationIds: ['createInvoice'],
  },
  reports: {
    id: 'reports',
    name: 'Billing reports',
    description: 'Read billing reports about revenue.',
    instructions: '# Billing reports\n\nAsk finance for the monthly billing report.',
    tags: ['billing'],
    operationIds: [],
  },
  refunds: {
    id: 'refunds',
    name: 'Billing refunds',
    description: 'Refund billing charges to customers.',
    instructions: '# Billing refunds\n\nRefund a charge from the billing console.',
    tags: ['billing'],
    operationIds: [],
  },
};

/** An unsigned billing bundle at `version` serving `skillIds`; its operation calls the billing API. */
export function billingBundle(version: string, skillIds: readonly BillingSkillId[]): ResolvedBundle {
  return {
    schemaVersion: 1,
    bundleId: 'e2e:managed-billing',
    version,
    generatedAt: '2026-11-04T12:00:00.000Z',
    sourceDigest: 'b'.repeat(64),
    services: [{ id: 'billing', baseUrl: BILLING_API_URL }],
    authBindings: { default: { kind: 'bearer', vaultRef: 'billing-token' } },
    skills: skillIds.map((skillId) => billingSkills[skillId]),
    operations: { createInvoice: createInvoiceOperation },
  };
}
