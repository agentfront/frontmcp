// A managed @frontmcp/edge Worker in workerd: pull over https, Cron refresh, token rejection, workflows and pushes.
import { base64urlEncode, randomBytes } from '@frontmcp/utils';

import {
  BILLING_API_URL,
  billingBundle,
  BUNDLE_URL,
  BundleSigner,
  BundleTokenIssuer,
  type BillingSkillId,
} from './helpers/managed-bundles';
import { ManagedInternet } from './helpers/managed-internet';
import { ManagedWorker } from './helpers/managed-worker';

interface SearchSkillResponse {
  skills: Array<{ skillId: string; bundleVersion?: string }>;
}

interface LoadSkillResponse {
  skill: { id: string; bundleVersion?: string; actions?: Array<{ actionId: string }> };
}

interface RunWorkflowResponse {
  success: boolean;
  value?: unknown;
  error?: string;
}

describe('a managed edge Worker on workerd', () => {
  const signer = new BundleSigner();
  const billingToken = base64urlEncode(randomBytes(32));
  let issuer: BundleTokenIssuer;
  let internet: ManagedInternet;
  let worker: ManagedWorker;

  const publish = (version: string, skillIds: readonly BillingSkillId[]) => {
    internet.bundle = signer.sign(billingBundle(version, skillIds));
  };

  const searchBilling = async () => {
    const result = await worker.callTool<SearchSkillResponse>('search_skill', { query: 'billing' });
    expect(result.isError).toBe(false);
    return result.json().skills;
  };

  const servedSkills = async () => (await searchBilling()).map((skill) => skill.skillId).sort();

  beforeAll(async () => {
    issuer = await BundleTokenIssuer.create('e2e-issuer-1');
    const pullToken = await issuer.pullToken();
    internet = new ManagedInternet({ jwks: issuer.jwks, pullToken, billingToken });
    publish('1.0.0', ['invoices', 'reports']);
    worker = await ManagedWorker.start({
      bindings: {
        BUNDLE_PULL_TOKEN: pullToken,
        BUNDLE_TRUSTED_KEY: JSON.stringify(signer.trustedKey),
        BILLING_API_TOKEN: billingToken,
      },
      outbound: internet.fetch,
    });
  }, 170_000);

  afterAll(async () => {
    await worker?.dispose();
  });

  it('pulls the bundle on its first request: search_skill and load_skill serve its skills', async () => {
    const skills = await searchBilling();
    const loaded = await worker.callTool<LoadSkillResponse>('load_skill', { skillId: 'invoices' });

    expect(skills.map((skill) => skill.skillId).sort()).toEqual(['invoices', 'reports']);
    expect(skills.every((skill) => skill.bundleVersion === '1.0.0')).toBe(true);
    expect(loaded.json().skill).toMatchObject({ id: 'invoices', bundleVersion: '1.0.0' });
    expect(loaded.json().skill.actions?.map((action) => action.actionId)).toEqual(['createInvoice']);
    expect(internet.requestsTo(BUNDLE_URL)).toHaveLength(1);
    expect(await worker.cachedBundleVersion()).toBe('1.0.0');
  });

  it('runs a workflow whose action reaches the billing API over https with the configured credential', async () => {
    const result = await worker.callTool<RunWorkflowResponse>('run_workflow', {
      script: "return await callTool('createInvoice', { customerId: 'cus_edge', amount: 12 });",
    });

    expect(result.json()).toMatchObject({ success: true, value: { id: 'inv_cus_edge', status: 'open' } });
    expect(internet.requestsTo(`${BILLING_API_URL}/v1/invoices`)).toEqual([
      expect.objectContaining({
        authorization: `Bearer ${billingToken}`,
        body: '{"customerId":"cus_edge","amount":12}',
      }),
    ]);
    expect(result.text).not.toContain(billingToken);
  });

  it('picks up a new bundle version on a Cron run, applied and kept in KV by the time the run ends', async () => {
    publish('2.0.0', ['invoices', 'refunds']);

    const run = await worker.scheduled();

    expect(run.outcome).toBe('ok');
    expect(await servedSkills()).toEqual(['invoices', 'refunds']);
    expect((await searchBilling()).every((skill) => skill.bundleVersion === '2.0.0')).toBe(true);
    expect(await worker.cachedBundleVersion()).toBe('2.0.0');
  });

  it('neither applies nor keeps a bundle changed after it was signed on a Cron run: KV keeps the version before', async () => {
    const signed = signer.sign(billingBundle('2.1.0', ['reports']));
    internet.bundle = { ...signed, skills: [...signed.skills, ...billingBundle('2.1.0', ['invoices']).skills] };

    const run = await worker.scheduled();

    expect(run.outcome).toBe('ok');
    expect(await servedSkills()).toEqual(['invoices', 'refunds']);
    expect(await worker.cachedBundleVersion()).toBe('2.0.0');
  });

  it('does not pull or apply a bundle when the issuer no longer accepts the pull token', async () => {
    const rotated = await BundleTokenIssuer.create('e2e-issuer-2');
    const trustedJwks = internet.jwks;
    internet.jwks = rotated.jwks;
    publish('3.0.0', ['reports']);
    const pullsBefore = internet.requestsTo(BUNDLE_URL).length;

    try {
      const run = await worker.scheduled();

      expect(run.outcome).toBe('exception');
      expect(internet.requestsTo(BUNDLE_URL)).toHaveLength(pullsBefore);
      expect(await servedSkills()).toEqual(['invoices', 'refunds']);
      expect(await worker.cachedBundleVersion()).toBe('2.0.0');
    } finally {
      internet.jwks = trustedJwks;
    }
  });

  describe('a bundle pushed to POST /__skilled_openapi/push', () => {
    it('is applied when its token and signature check out, and kept in KV', async () => {
      const response = await worker.push(
        `Bearer ${await issuer.pushToken()}`,
        signer.sign(billingBundle('4.0.0', ['invoices', 'refunds', 'reports'])),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ applied: true, bundleId: 'e2e:managed-billing', bundleVersion: '4.0.0' });
      expect(await servedSkills()).toEqual(['invoices', 'refunds', 'reports']);
      expect(await worker.cachedBundleVersion()).toBe('4.0.0');
    });

    it('is refused when it replays the token of an earlier push', async () => {
      const token = await issuer.pushToken();
      const first = await worker.push(`Bearer ${token}`, signer.sign(billingBundle('5.0.0', ['invoices'])));

      const replayed = await worker.push(`Bearer ${token}`, signer.sign(billingBundle('6.0.0', ['reports'])));

      expect(first.status).toBe(200);
      expect(replayed.status).toBe(409);
      expect(await replayed.json()).toMatchObject({ error: 'push_replayed' });
      expect(await servedSkills()).toEqual(['invoices']);
    });

    it('is refused when its token is missing or not signed by the issuer', async () => {
      const impostor = await BundleTokenIssuer.create('e2e-issuer-1');
      const bundle = signer.sign(billingBundle('7.0.0', ['reports']));

      const forged = await worker.push(`Bearer ${await impostor.pushToken()}`, bundle);
      const anonymous = await worker.push(undefined, bundle);

      expect([forged.status, anonymous.status]).toEqual([401, 401]);
      expect(forged.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
      expect(await forged.json()).toMatchObject({ error: 'invalid_token' });
      expect(await servedSkills()).toEqual(['invoices']);
      expect(await worker.cachedBundleVersion()).toBe('5.0.0');
    });

    it('is refused when the bundle was changed after signing, or is not a bundle', async () => {
      const signed = signer.sign(billingBundle('8.0.0', ['reports']));
      const tampered = { ...signed, skills: [...signed.skills, ...billingBundle('8.0.0', ['refunds']).skills] };

      const changed = await worker.push(`Bearer ${await issuer.pushToken()}`, tampered);
      const notBundle = await worker.push(`Bearer ${await issuer.pushToken()}`, { version: '9.0.0' });

      expect(changed.status).toBe(422);
      expect(await changed.json()).toMatchObject({
        error: 'bundle_not_applied',
        error_description: expect.stringContaining('digest mismatch'),
      });
      expect(notBundle.status).toBe(400);
      expect(await notBundle.json()).toMatchObject({ error: 'invalid_bundle' });
      expect(await servedSkills()).toEqual(['invoices']);
    });
  });
});
