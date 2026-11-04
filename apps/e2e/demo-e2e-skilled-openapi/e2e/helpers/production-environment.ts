import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringify as toYaml } from 'yaml';

import { bundleDigest, canonicalize, type ResolvedBundle, type SignatureKey } from '@frontmcp/adapters/skills';
import {
  base64urlEncode,
  generateRsaKeyPair,
  mkdtemp,
  randomBytes,
  readFile,
  rm,
  rsaSignBase64Url,
  runCmd,
  writeFile,
} from '@frontmcp/utils';

import { startMockBillingApi, type MockBillingApi } from './mock-billing-api';

const BUNDLE_TEMPLATE_PATH = join(__dirname, '../../src/fixtures/billing-bundle.json');
const SIGNING_KEY_ID = 'e2e-signing-key';

/** The callers who connect their own billing account (e2e/caller-credentials.e2e.spec.ts). */
export type ConnectedCaller = 'alice' | 'bob';

interface RunningEnvironment {
  directory: string;
  billingApi: MockBillingApi;
  billingToken: string;
  callerBillingTokens: Readonly<Record<ConnectedCaller, string>>;
}

/** Keys, certificate, signed bundle and credentials made per run in a temporary directory: nothing secret is committed. */
export class ProductionEnvironment {
  /** The server's environment; pass it to `test.use({ env })` before `start()` fills it. */
  readonly env: Record<string, string> = {};
  /** The same environment with a bundle changed after it was signed. */
  readonly tamperedBundleEnv: Record<string, string> = {};
  /** The same environment with the signed bundle written as YAML, as `yaml.stringify` writes it. */
  readonly yamlBundleEnv: Record<string, string> = {};
  private running?: RunningEnvironment;

  get billingApi(): MockBillingApi {
    return this.requireRunning().billingApi;
  }

  /** The credential the server sends the billing API, which no result or log may show. */
  get billingToken(): string {
    return this.requireRunning().billingToken;
  }

  /** The billing token each connected caller signs in with, which the billing API also accepts. */
  get callerBillingTokens(): Readonly<Record<ConnectedCaller, string>> {
    return this.requireRunning().callerBillingTokens;
  }

  async start(): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'skilled-openapi-e2e-'));
    const keyPath = join(directory, 'tls-key.pem');
    const certPath = join(directory, 'tls-cert.pem');
    await runCmd('openssl', [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ]);

    const billingToken = base64urlEncode(randomBytes(32));
    const callerBillingTokens = { alice: base64urlEncode(randomBytes(32)), bob: base64urlEncode(randomBytes(32)) };
    const billingApi = await startMockBillingApi({
      bearerTokens: [billingToken, ...Object.values(callerBillingTokens)],
      tls: { key: await readFile(keyPath), cert: await readFile(certPath) },
    });
    this.running = { directory, billingApi, billingToken, callerBillingTokens };

    const template = JSON.parse(await readFile(BUNDLE_TEMPLATE_PATH)) as ResolvedBundle;
    const bundle: ResolvedBundle = {
      ...template,
      services: template.services.map((service) => ({ ...service, baseUrl: billingApi.url })),
    };
    const signingKeys = generateRsaKeyPair();
    const signed = signBundle(bundle, signingKeys.privateKey.export({ format: 'jwk' }));
    const tampered: ResolvedBundle = {
      ...signed,
      skills: signed.skills.map(({ requiredAuthorities: _opened, ...skill }) => skill),
    };
    const trustedKey: SignatureKey = {
      keyId: SIGNING_KEY_ID,
      alg: 'RS256',
      publicKeyPem: String(signingKeys.publicKey.export({ type: 'spki', format: 'pem' })),
    };

    const signedPath = join(directory, 'billing-bundle.signed.json');
    const tamperedPath = join(directory, 'billing-bundle.tampered.json');
    const yamlPath = join(directory, 'billing-bundle.signed.yaml');
    await writeFile(signedPath, JSON.stringify(signed));
    await writeFile(tamperedPath, JSON.stringify(tampered));
    await writeFile(yamlPath, toYaml(signed));

    Object.assign(this.env, {
      SKILLED_BUNDLE_PATH: signedPath,
      SKILLED_TRUSTED_KEY: JSON.stringify(trustedKey),
      BILLING_API_TOKEN: billingToken,
      NODE_EXTRA_CA_CERTS: certPath,
      JWT_SECRET: base64urlEncode(randomBytes(32)),
      MCP_SESSION_SECRET: base64urlEncode(randomBytes(32)),
    });
    Object.assign(this.tamperedBundleEnv, { SKILLED_BUNDLE_PATH: tamperedPath });
    Object.assign(this.yamlBundleEnv, { SKILLED_BUNDLE_PATH: yamlPath });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    const { billingApi, directory } = this.running;
    this.running = undefined;
    await billingApi.stop();
    await rm(directory, { recursive: true, force: true });
  }

  private requireRunning(): RunningEnvironment {
    if (!this.running) throw new Error('ProductionEnvironment.start() has not run: call it in a beforeAll');
    return this.running;
  }
}

function signBundle(bundle: ResolvedBundle, privateJwk: JsonWebKey): ResolvedBundle {
  const { integrity: _unsigned, ...content } = bundle;
  const signature = rsaSignBase64Url('RS256', new TextEncoder().encode(canonicalize(content)), privateJwk);
  return {
    ...content,
    integrity: { alg: 'RS256', keyId: SIGNING_KEY_ID, digest: bundleDigest(content), signature },
  };
}
