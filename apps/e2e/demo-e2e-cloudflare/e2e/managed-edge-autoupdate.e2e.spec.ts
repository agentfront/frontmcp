// A managed @frontmcp/edge Worker in workerd: pull over https, Cron refresh (also as an isolate's first event), token
// rejection, workflows and pushes, older ones refused, a push token replayed to another replica refused, and one bound
// to another body (body_sha256) refused. A Cron run whose bundle is refused, or that serves the cached bundle, fails,
// and /readyz says the bundle served is stale. A new isolate serves the KV bundle in place of an older pull, and an
// outage start leaves the KV entry as it was.
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
  skill: { id: string; bundleVersion?: string; actions?: Array<{ actionId: string; asksForConfirmation?: true }> };
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
    expect(loaded.json().skill.actions?.map((action) => action.actionId)).toEqual(['createInvoice', 'voidInvoice']);
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

  describe("managed.confirm: { methods: ['DELETE'] }, on a Worker that can't enable elicitation", () => {
    const VOID_INVOICE = { actionId: 'voidInvoice', input: { id: 'inv_edge' } };
    const CANNOT_ASK =
      "the user's confirmation is needed for voidInvoice, and this server can't ask for it: elicitation is disabled; nothing was sent";
    const voidRequests = () => internet.requests.filter((request) => request.method === 'DELETE');

    it('refuses the DELETE action in execute_action and run_workflow, sending nothing', async () => {
      const action = await worker.callTool('execute_action', VOID_INVOICE);
      const workflow = await worker.callTool<RunWorkflowResponse>('run_workflow', {
        script: "return await callTool('voidInvoice', { id: 'inv_edge' });",
      });

      expect(action.isError).toBe(true);
      expect(action.text).toBe(CANNOT_ASK);
      expect(workflow.json()).toEqual({ success: false, error: CANNOT_ASK });
      expect(voidRequests()).toEqual([]);
    });

    it('refuses it to a client that declares elicitation too, without asking', async () => {
      const answer = await worker.callToolAsking('execute_action', VOID_INVOICE);

      expect(answer.resultType).not.toBe('input_required');
      expect(answer.isError).toBe(true);
      expect(answer.content?.[0]?.text).toBe(CANNOT_ASK);
      expect(voidRequests()).toEqual([]);
    });

    it('still runs an action the rule does not name', async () => {
      const result = await worker.callTool<{ id: string }>('execute_action', {
        actionId: 'createInvoice',
        input: { customerId: 'cus_confirm', amount: 3 },
      });

      expect(result.isError).toBe(false);
      expect(result.json()).toMatchObject({ id: 'inv_cus_confirm' });
    });

    it('marks the DELETE action in load_skill as one that asks for confirmation', async () => {
      const loaded = await worker.callTool<LoadSkillResponse>('load_skill', { skillId: 'invoices' });

      expect(loaded.json().skill.actions).toEqual([
        expect.not.objectContaining({ asksForConfirmation: true }),
        expect.objectContaining({ actionId: 'voidInvoice', asksForConfirmation: true }),
      ]);
    });
  });

  it('picks up a new bundle version on a Cron run, applied and kept in KV by the time the run ends', async () => {
    publish('2.0.0', ['invoices', 'refunds']);

    const run = await worker.scheduled();

    expect(run.outcome).toBe('ok');
    expect(await servedSkills()).toEqual(['invoices', 'refunds']);
    expect((await searchBilling()).every((skill) => skill.bundleVersion === '2.0.0')).toBe(true);
    expect(await worker.cachedBundleVersion()).toBe('2.0.0');
  });

  it('fails a Cron run that pulls a bundle changed after it was signed: not applied or kept, and /readyz says so', async () => {
    const signed = signer.sign(billingBundle('2.1.0', ['reports']));
    internet.bundle = { ...signed, skills: [...signed.skills, ...billingBundle('2.1.0', ['invoices']).skills] };

    const run = await worker.scheduled();
    const ready = await worker.readiness();

    expect(run.outcome).toBe('exception');
    expect(await servedSkills()).toEqual(['invoices', 'refunds']);
    expect(await worker.cachedBundleVersion()).toBe('2.0.0');
    expect(ready).toMatchObject({ httpStatus: 200, status: 'ready' });
    expect(ready.probes?.['skilled-openapi']).toEqual({
      status: 'degraded',
      details: {
        state: 'stale',
        bundleId: 'e2e:managed-billing',
        bundleVersion: '2.0.0',
        lastSync: {
          status: 'refused',
          bundleId: 'e2e:managed-billing',
          bundleVersion: '2.1.0',
          reason: expect.stringContaining('digest mismatch'),
          at: expect.any(String),
        },
      },
    });
  });

  it('fails a Cron run that pulls a signed bundle older than the one served: /readyz names the refusal', async () => {
    publish('1.0.0', ['invoices', 'reports']);

    const run = await worker.scheduled();

    expect(run.outcome).toBe('exception');
    expect(await servedSkills()).toEqual(['invoices', 'refunds']);
    expect(await worker.cachedBundleVersion()).toBe('2.0.0');
    expect((await worker.readiness()).probes?.['skilled-openapi']).toMatchObject({
      status: 'degraded',
      details: {
        state: 'stale',
        bundleVersion: '2.0.0',
        lastSync: {
          status: 'refused',
          bundleVersion: '1.0.0',
          reason: expect.stringContaining('older than the served bundle e2e:managed-billing@2.0.0'),
        },
      },
    });
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
      expect((await worker.readiness()).probes?.['skilled-openapi']).toEqual({
        status: 'healthy',
        details: { state: 'loaded', bundleId: 'e2e:managed-billing', bundleVersion: '4.0.0' },
      });
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

    it('is refused when it is older than the bundle being served, though signed: KV keeps the served one', async () => {
      const response = await worker.push(
        `Bearer ${await issuer.pushToken()}`,
        signer.sign(billingBundle('4.0.0', ['invoices', 'refunds', 'reports'])),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'bundle_outdated',
        error_description: expect.stringContaining('older than the served bundle e2e:managed-billing@5.0.0'),
      });
      expect(await servedSkills()).toEqual(['invoices']);
      expect(await worker.cachedBundleVersion()).toBe('5.0.0');
    });

    it('is refused, with 409, when its token is replayed to another replica of the Worker', async () => {
      const replica = worker.secondReplica();
      const replicaSkills = async () => {
        const result = await replica.callTool<SearchSkillResponse>('search_skill', { query: 'billing' });
        return result
          .json()
          .skills.map((skill) => `${skill.skillId}@${skill.bundleVersion}`)
          .sort();
      };
      publish('9.0.0', ['invoices', 'reports']);
      const servedBeforeReplay = await replicaSkills();
      const token = await issuer.pushToken();

      const first = await worker.push(`Bearer ${token}`, signer.sign(billingBundle('10.0.0', ['refunds'])));
      const replayed = await replica.push(`Bearer ${token}`, signer.sign(billingBundle('10.0.0', ['refunds'])));
      const servedAfterReplay = await replicaSkills();
      const fresh = await replica.push(
        `Bearer ${await issuer.pushToken()}`,
        signer.sign(billingBundle('11.0.0', ['refunds'])),
      );

      expect(servedBeforeReplay).toEqual(['invoices@9.0.0', 'reports@9.0.0']);
      expect(first.status).toBe(200);
      expect(replayed.status).toBe(409);
      expect(await replayed.json()).toEqual({
        error: 'push_replayed',
        error_description: 'a push already used this token',
      });
      expect(servedAfterReplay).toEqual(servedBeforeReplay);
      expect(fresh.status).toBe(200);
      expect(await replicaSkills()).toEqual(['refunds@11.0.0']);
    });

    it('is refused, with 401, when its token was issued for another body: the body it was issued for still applies', async () => {
      const issuedFor = JSON.stringify(signer.sign(billingBundle('12.0.0', ['invoices', 'reports'])));
      const otherBundle = JSON.stringify(signer.sign(billingBundle('12.0.0', ['refunds'])));
      const token = await issuer.pushTokenFor(issuedFor);

      const swapped = await worker.push(`Bearer ${token}`, otherBundle);
      const servedAfterSwap = await servedSkills();
      const genuine = await worker.push(`Bearer ${token}`, issuedFor);

      expect(swapped.status).toBe(401);
      expect(swapped.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
      expect(await swapped.json()).toEqual({ error: 'invalid_token', error_description: 'the push token was refused' });
      expect(servedAfterSwap).toEqual(['refunds']);
      expect(worker.log).toContain('push refused (body_mismatch)');
      expect(genuine.status).toBe(200);
      expect(await servedSkills()).toEqual(['invoices', 'reports']);
      expect(await worker.cachedBundleVersion()).toBe('12.0.0');
    });
  });
});

describe('a managed edge Worker whose first event is a Cron run', () => {
  const signer = new BundleSigner();
  const billingToken = base64urlEncode(randomBytes(32));
  let internet: ManagedInternet;
  let worker: ManagedWorker;

  beforeAll(async () => {
    const issuer = await BundleTokenIssuer.create('e2e-issuer-cold');
    const pullToken = await issuer.pullToken();
    internet = new ManagedInternet({ jwks: issuer.jwks, pullToken, billingToken });
    internet.bundle = signer.sign(billingBundle('1.0.0', ['invoices', 'reports']));
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

  it('applies the bundle it pulls and keeps it in KV, with one pull, and serves it to the first request', async () => {
    const run = await worker.scheduled();
    const cachedAfterRun = await worker.cachedBundleVersion();
    const pullsAfterRun = internet.requestsTo(BUNDLE_URL).length;

    const search = await worker.callTool<SearchSkillResponse>('search_skill', { query: 'billing' });

    expect(run.outcome).toBe('ok');
    expect(cachedAfterRun).toBe('1.0.0');
    expect(pullsAfterRun).toBe(1);
    expect(search.isError).toBe(false);
    expect(
      search
        .json()
        .skills.map((skill) => [skill.skillId, skill.bundleVersion])
        .sort(),
    ).toEqual([
      ['invoices', '1.0.0'],
      ['reports', '1.0.0'],
    ]);
    expect(internet.requestsTo(BUNDLE_URL)).toHaveLength(1);
  });

  it('pulls again on the next Cron run, and keeps the new version', async () => {
    internet.bundle = signer.sign(billingBundle('2.0.0', ['invoices', 'refunds']));

    const run = await worker.scheduled();

    expect(run.outcome).toBe('ok');
    expect(internet.requestsTo(BUNDLE_URL)).toHaveLength(2);
    expect(await worker.cachedBundleVersion()).toBe('2.0.0');
  });

  it('fails the Cron run of an isolate that starts while the bundle server serves an older bundle: KV keeps its newer one, which serves', async () => {
    internet.bundle = signer.sign(billingBundle('1.0.0', ['invoices', 'reports']));
    const replica = worker.thirdReplica();

    const run = await replica.scheduled();
    const ready = await replica.readiness();
    const search = await replica.callTool<SearchSkillResponse>('search_skill', { query: 'billing' });

    expect(run.outcome).toBe('exception');
    expect(
      search
        .json()
        .skills.map((skill) => `${skill.skillId}@${skill.bundleVersion}`)
        .sort(),
    ).toEqual(['invoices@2.0.0', 'refunds@2.0.0']);
    expect(await replica.cachedBundleVersion()).toBe('2.0.0');
    expect(ready).toMatchObject({ httpStatus: 200, status: 'ready' });
    expect(ready.probes?.['skilled-openapi']).toEqual({
      status: 'degraded',
      details: {
        state: 'stale',
        bundleId: 'e2e:managed-billing',
        bundleVersion: '2.0.0',
        lastSync: {
          status: 'refused',
          bundleId: 'e2e:managed-billing',
          bundleVersion: '1.0.0',
          reason: 'older than the cached bundle e2e:managed-billing@2.0.0 (generatedAt 2026-11-04T12:00:00.000Z)',
          cacheFallback: true,
          at: expect.any(String),
        },
      },
    });
  });

  it('fails the Cron run of an isolate that starts while the bundle server is down, though it serves the cached bundle, and leaves KV as it was', async () => {
    internet.bundle = undefined;
    const replica = worker.secondReplica();
    const keptByEarlierDeploy = JSON.stringify(signer.sign(billingBundle('2.0.0', ['invoices', 'refunds'])), null, 2);
    await replica.storeCachedBundleEntry(keptByEarlierDeploy);

    const run = await replica.scheduled();
    const ready = await replica.readiness();

    expect(run.outcome).toBe('exception');
    expect(await replica.cachedBundleEntry()).toBe(keptByEarlierDeploy);
    expect(ready).toMatchObject({ httpStatus: 200, status: 'ready' });
    expect(ready.probes?.['skilled-openapi']).toEqual({
      status: 'degraded',
      details: {
        state: 'stale',
        bundleId: 'e2e:managed-billing',
        bundleVersion: '2.0.0',
        lastSync: { status: 'failed', reason: 'pull responded 404', cacheFallback: true, at: expect.any(String) },
      },
    });
  });
});
