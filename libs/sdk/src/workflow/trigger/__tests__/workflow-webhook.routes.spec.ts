/**
 * A `trigger: 'webhook'` workflow is served at its path through the `http:route` flow: a request signed with its
 * secret starts a background run with the JSON body as input, under the workflow's `execute` rules for the role
 * `webhook:<workflow>`, and every unsigned or badly signed request gets the same 401.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer } from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  HttpRoute,
  Job,
  JobContext,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  resolvePrincipal,
  Workflow,
  WorkflowTriggerPrincipal,
  type FrontMcpConfigInput,
  type LogRecord,
  type WorkflowMetadata,
} from '../../../common';
import { HttpRouteContext } from '../../../common/interfaces/http-route.interface';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { jobExecutionManagerOf } from '../../../job/job-run-access';
import { type Scope } from '../../../scope/scope.instance';
import { type WebFetchHandler } from '../../../transport/web-fetch-handler';
import { signWorkflowWebhook } from '../workflow-webhook.signature';

const secretOf = (workflow: string) => `${workflow}-webhook-secret-0123456789abcdef`;
const OTHER_SECRET = 'other-webhook-secret-0123456789abcdef';
const encoder = new TextEncoder();
const recorded: Array<Record<string, unknown>> = [];
const warnings: string[] = [];

@LogTransport({ name: 'WebhookWarnings', description: 'Keeps the warnings for assertions' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record.message);
  }
}

@Job({ name: 'record', inputSchema: { ref: z.string().optional() }, outputSchema: {} })
class RecordJob extends JobContext {
  async execute(input: Record<string, unknown>) {
    recorded.push(input);
    return {};
  }
}

@Job({
  name: 'admin-only',
  inputSchema: {},
  outputSchema: {},
  permissions: [{ action: 'execute', roles: ['admin'] }],
})
class AdminOnlyJob extends JobContext {
  async execute() {
    return {};
  }
}

const webhookWorkflow = (name: string, options: Partial<WorkflowMetadata> = {}) =>
  Workflow({
    name,
    trigger: 'webhook',
    steps: [{ id: 'record', jobName: 'record' }],
    ...options,
    webhook: { secret: secretOf(name), ...options.webhook },
  });

@webhookWorkflow('deploy', { inputSchema: { ref: z.string() } })
class DeployWorkflow {}

@webhookWorkflow('nightly', { webhook: { path: '/hooks/nightly', methods: ['GET'] } })
class NightlyWorkflow {}

@webhookWorkflow('small', { webhook: { path: '/hooks/small', maxBodyBytes: 32 } })
class SmallWorkflow {}

@webhookWorkflow('guarded', { permissions: [{ action: 'execute', roles: ['admin'] }] })
class GuardedWorkflow {}

@webhookWorkflow('allowed', { permissions: [{ action: 'execute', roles: ['admin', 'webhook:allowed'] }] })
class AllowedWorkflow {}

@webhookWorkflow('step-guarded', { steps: [{ id: 'admin', jobName: 'admin-only' }] })
class StepGuardedWorkflow {}

@webhookWorkflow('create-guarded', {
  permissions: [
    { action: 'execute', roles: ['webhook:create-guarded'] },
    { action: 'create', roles: ['admin'] },
  ],
})
class CreateGuardedWorkflow {}

@App({
  id: 'hooks',
  name: 'Hooks',
  jobs: [RecordJob, AdminOnlyJob],
  workflows: [
    DeployWorkflow,
    NightlyWorkflow,
    SmallWorkflow,
    GuardedWorkflow,
    AllowedWorkflow,
    StepGuardedWorkflow,
    CreateGuardedWorkflow,
  ],
})
class HooksApp {}

const CONFIG: FrontMcpConfigInput = {
  info: { name: 'workflow-webhooks', version: '1.0.0' },
  apps: [HooksApp],
  logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
};

interface SignOptions {
  secret?: string;
  timestamp?: number;
  method?: 'GET' | 'POST';
  contentType?: string;
}

let signedCount = 0;

/** A request to a webhook path, signed with its workflow's secret at a timestamp of its own. */
function signedRequest(path: string, body: string, options: SignOptions = {}): Request {
  const method = options.method ?? 'POST';
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000) - (signedCount++ % 120));
  const secret = options.secret ?? secretOf(path.split('/').pop() ?? '');
  const signature = signWorkflowWebhook(secret, timestamp, encoder.encode(body));
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': options.contentType ?? 'application/json',
      'x-frontmcp-timestamp': timestamp,
      'x-frontmcp-signature': signature,
    },
    ...(method === 'POST' ? { body } : {}),
  });
}

async function runEnd(scope: Scope, runId: string): Promise<{ state: string; input?: unknown; ownerSub?: string }> {
  const manager = jobExecutionManagerOf(scope);
  const deadline = Date.now() + 5_000;
  for (;;) {
    const record = await manager?.getStatus(runId);
    if (record && !['pending', 'running'].includes(record.state)) return record;
    if (Date.now() > deadline) throw new Error(`run ${runId} did not end`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('workflow webhooks', () => {
  let instance: FrontMcpInstance;
  let handler: WebFetchHandler;
  let scope: Scope;

  beforeAll(async () => {
    ({ handler, instance } = await createTestFetchServer(CONFIG));
    scope = instance.getScopes()[0] as Scope;
  });

  afterAll(async () => {
    await instance.shutdown();
  });

  beforeEach(() => {
    recorded.length = 0;
    warnings.length = 0;
  });

  async function runCount(): Promise<number> {
    return (await jobExecutionManagerOf(scope)?.listRuns())?.length ?? 0;
  }

  it('starts a background run with the JSON body as input, and answers 202 with its runId', async () => {
    const response = await handler(signedRequest('/workflows/webhook/deploy', '{"ref":"main"}'));
    const answer = (await response.json()) as { runId: string; state: string };

    expect(response.status).toBe(202);
    expect(answer).toEqual({ runId: expect.any(String), state: 'pending' });
    const run = await runEnd(scope, answer.runId);
    expect(run).toEqual(expect.objectContaining({ state: 'completed', input: { ref: 'main' } }));
    expect(run.ownerSub).toBeUndefined();
    expect(recorded).toEqual([{ ref: 'main' }]);
  });

  describe('refusals', () => {
    const now = () => Math.floor(Date.now() / 1000);

    it.each([
      ['no signature', () => new Request('http://localhost/workflows/webhook/deploy', jsonPost('{"ref":"main"}'))],
      ['another secret', () => signedRequest('/workflows/webhook/deploy', '{"ref":"main"}', { secret: OTHER_SECRET })],
      [
        'an old timestamp',
        () => signedRequest('/workflows/webhook/deploy', '{"ref":"main"}', { timestamp: now() - 301 }),
      ],
      [
        'a future timestamp',
        () => signedRequest('/workflows/webhook/deploy', '{"ref":"main"}', { timestamp: now() + 301 }),
      ],
      [
        'a changed body',
        () => withBody(signedRequest('/workflows/webhook/deploy', '{"ref":"main"}'), '{"ref":"prod"}'),
      ],
    ])('answers %s with the same 401, and starts no run', async (_label, request) => {
      const before = await runCount();
      const response = await handler(request());

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized' });
      expect(await runCount()).toBe(before);
    });

    it('answers a request sent again with 401, and starts one run', async () => {
      const request = signedRequest('/workflows/webhook/deploy', '{"ref":"main"}');
      const replay = request.clone();

      expect((await handler(request)).status).toBe(202);
      const before = await runCount();
      const response = await handler(replay);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized' });
      expect(await runCount()).toBe(before);
      expect(warnings).toContain('Webhook of workflow "deploy" refused a request: replayed');
    });

    it('answers a body larger than maxBodyBytes with 413, before the signature', async () => {
      const response = await handler(signedRequest('/hooks/small', JSON.stringify({ ref: 'x'.repeat(64) })));

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: 'Payload too large' });
    });

    it('answers a body that is not application/json with 415', async () => {
      const response = await handler(
        signedRequest('/workflows/webhook/deploy', 'ref=main', { contentType: 'application/x-www-form-urlencoded' }),
      );

      expect(response.status).toBe(415);
    });

    it('answers a signed body that is not a JSON object with 400', async () => {
      const response = await handler(signedRequest('/workflows/webhook/deploy', '["main"]'));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'The body must be a JSON object' });
    });

    it("answers input that doesn't match the inputSchema with 400 and the issues", async () => {
      const response = await handler(signedRequest('/workflows/webhook/deploy', '{"ref":7}'));
      const answer = (await response.json()) as { error: string; issues: Array<{ path: string[] }> };

      expect(response.status).toBe(400);
      expect(answer.error).toBe('Invalid input for workflow "deploy"');
      expect(answer.issues[0].path).toEqual(['ref']);
    });

    it('answers only the configured methods', async () => {
      expect((await handler(signedRequest('/workflows/webhook/deploy', '', { method: 'GET' }))).status).toBe(404);
      expect((await handler(signedRequest('/hooks/nightly', '{}'))).status).toBe(404);
    });
  });

  it('starts a GET webhook with no input, signed over an empty body', async () => {
    const response = await handler(signedRequest('/hooks/nightly', '', { method: 'GET' }));

    expect(response.status).toBe(202);
    await runEnd(scope, ((await response.json()) as { runId: string }).runId);
    expect(recorded).toEqual([{}]);
  });

  describe('the run’s principal', () => {
    it('is refused with 403 by execute rules that do not allow webhook:<workflow>, and the log says how', async () => {
      const before = await runCount();
      const response = await handler(signedRequest('/workflows/webhook/guarded', '{}'));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Forbidden' });
      expect(await runCount()).toBe(before);
      expect(warnings).toContainEqual(expect.stringContaining('don\'t allow the role "webhook:guarded"'));
    });

    it('starts a run when a rule allows webhook:<workflow>', async () => {
      const response = await handler(signedRequest('/workflows/webhook/allowed', '{}'));

      expect(response.status).toBe(202);
      const run = await runEnd(scope, ((await response.json()) as { runId: string }).runId);
      expect(run.state).toBe('completed');
    });

    it('is refused with 403 by create rules that do not allow it, whatever its execute rules allow', async () => {
      const response = await handler(signedRequest('/workflows/webhook/create-guarded', '{}'));

      expect(response.status).toBe(403);
      expect(warnings).toContainEqual(expect.stringContaining('don\'t allow the role "webhook:create-guarded"'));
    });

    it("is checked against each step job's execute rules too", async () => {
      const response = await handler(signedRequest('/workflows/webhook/step-guarded', '{}'));

      expect(response.status).toBe(202);
      const run = await runEnd(scope, ((await response.json()) as { runId: string }).runId);
      expect(run.state).toBe('failed');
    });

    it('is the role alone, whatever claims a caller sends, and no caller can forge it', () => {
      const trigger = new WorkflowTriggerPrincipal('webhook', 'allowed');
      const forged = { extra: { workflowTrigger: { kind: 'webhook', name: 'allowed', role: 'webhook:allowed' } } };

      expect(resolvePrincipal(trigger.toAuthInfo())).toEqual({
        sub: '',
        roles: ['webhook:allowed'],
        permissions: [],
        scopes: [],
        claims: {},
      });
      expect(resolvePrincipal(forged).roles).toEqual([]);
    });
  });

  describe('the http:route flow', () => {
    it('refuses a denied peer before the signature', async () => {
      const filtered = await createTestFetchServer({
        ...CONFIG,
        throttle: { enabled: true, ipFilter: { denyList: ['203.0.113.7'] } },
      });
      try {
        const request = signedRequest('/workflows/webhook/allowed', '{}');
        const response = await filtered.handler(request, { remoteAddr: { hostname: '203.0.113.7' } } as never);

        expect(response.status).toBe(403);
        expect(recorded).toEqual([]);
      } finally {
        await filtered.instance.shutdown();
      }
    });

    it('counts webhook requests against the global rate limit', async () => {
      const limited = await createTestFetchServer({
        ...CONFIG,
        throttle: { enabled: true, global: { maxRequests: 1, windowMs: 60_000 } },
      });
      try {
        expect((await limited.handler(signedRequest('/workflows/webhook/allowed', '{}'))).status).toBe(202);
        expect((await limited.handler(signedRequest('/workflows/webhook/allowed', '{"a":1}'))).status).toBe(429);
      } finally {
        await limited.instance.shutdown();
      }
    });
  });
});

function jsonPost(body: string): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body };
}

function withBody(request: Request, body: string): Request {
  return new Request(request.url, { method: request.method, headers: request.headers, body });
}

@HttpRoute({ method: 'POST', path: '/hooks/:name', auth: 'public' })
class HookByNameRoute extends HttpRouteContext {
  handle() {
    return { name: this.params['name'] };
  }
}

describe('startup', () => {
  const start = (workflows: unknown[], extra: Partial<FrontMcpConfigInput> = {}, routes: unknown[] = []) => {
    @App({ id: 'start', name: 'Start', jobs: [RecordJob], workflows: workflows as never[], routes: routes as never[] })
    class StartApp {}
    return createTestFetchServer({ info: { name: 'start', version: '1.0.0' }, apps: [StartApp], ...extra });
  };
  const steps = [{ id: 'record', jobName: 'record' }];

  it('refuses a webhook workflow without a secret', async () => {
    @Workflow({ name: 'no-secret', trigger: 'webhook', steps })
    class NoSecret {}

    await expect(start([NoSecret])).rejects.toThrow(`Workflow "no-secret": trigger: 'webhook' needs webhook.secret`);
  });

  it('refuses a secret shorter than 32 characters', async () => {
    @Workflow({ name: 'short', trigger: 'webhook', webhook: { secret: 'too-short' }, steps })
    class ShortSecret {}

    await expect(start([ShortSecret])).rejects.toThrow('webhook.secret must be at least 32 characters');
  });

  it('refuses a webhook on a workflow whose trigger is not webhook', async () => {
    @Workflow({ name: 'manual', webhook: { secret: secretOf('manual') }, steps })
    class ManualWithWebhook {}

    await expect(start([ManualWithWebhook])).rejects.toThrow("webhook is set, but trigger is not 'webhook'");
  });

  it('refuses a path with a parameter, and an empty methods list', async () => {
    @Workflow({ name: 'param', trigger: 'webhook', webhook: { secret: secretOf('param'), path: '/hooks/:id' }, steps })
    class ParamPath {}
    @Workflow({ name: 'none', trigger: 'webhook', webhook: { secret: secretOf('none'), methods: [] }, steps })
    class NoMethods {}

    await expect(start([ParamPath])).rejects.toThrow('must start with "/" and hold literal segments only');
    await expect(start([NoMethods])).rejects.toThrow('webhook.methods must name GET, POST or both');
  });

  it('refuses two webhooks with one secret', async () => {
    @Workflow({ name: 'first', trigger: 'webhook', webhook: { secret: secretOf('shared') }, steps })
    class First {}
    @Workflow({ name: 'second', trigger: 'webhook', webhook: { secret: secretOf('shared') }, steps })
    class Second {}

    await expect(start([First, Second])).rejects.toThrow(
      `Workflow "second": its webhook.secret is also workflow "first"'s`,
    );
  });

  it('refuses two webhooks on one path', async () => {
    @Workflow({ name: 'one', trigger: 'webhook', webhook: { secret: secretOf('one'), path: '/hooks/same' }, steps })
    class One {}
    @Workflow({ name: 'two', trigger: 'webhook', webhook: { secret: secretOf('two'), path: '/hooks/same' }, steps })
    class Two {}

    await expect(start([One, Two])).rejects.toThrow(
      'the webhook of workflow "two" collides with the route POST /hooks/same',
    );
  });

  it('refuses a webhook an @HttpRoute or an http.routes entry would answer', async () => {
    @Workflow({
      name: 'shadowed',
      trigger: 'webhook',
      webhook: { secret: secretOf('shadowed'), path: '/hooks/deploy' },
      steps,
    })
    class Shadowed {}
    @Workflow({ name: 'custom', trigger: 'webhook', webhook: { secret: secretOf('custom'), path: '/custom' }, steps })
    class Custom {}

    await expect(start([Shadowed], {}, [HookByNameRoute])).rejects.toThrow(
      'the webhook of workflow "shadowed" collides with the route POST /hooks/:name',
    );
    await expect(
      start([Custom], { http: { routes: [{ method: 'POST', path: '/custom', handler: () => undefined }] } }),
    ).rejects.toThrow('the webhook of workflow "custom" collides with the route POST /custom');
  });

  it("refuses a webhook on the MCP endpoint's path or a reserved one", async () => {
    @Workflow({ name: 'on-mcp', trigger: 'webhook', webhook: { secret: secretOf('on-mcp'), path: '/' }, steps })
    class OnMcp {}
    @Workflow({
      name: 'on-health',
      trigger: 'webhook',
      webhook: { secret: secretOf('on-health'), path: '/health' },
      steps,
    })
    class OnHealth {}

    await expect(start([OnMcp])).rejects.toThrow(`the webhook of workflow "on-mcp" is on the MCP endpoint's path`);
    await expect(start([OnHealth])).rejects.toThrow('/health');
  });
});

describe('register_workflow', () => {
  it("refuses trigger: 'webhook', whose route and secret are fixed when the server starts", async () => {
    @App({ id: 'dynamic', name: 'Dynamic', jobs: [RecordJob] })
    class DynamicApp {}
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'dynamic-webhooks', version: '1.0.0' },
      apps: [DynamicApp],
      jobs: { enabled: true, allowDynamicRegistration: true },
      logging: { level: LogLevel.Off },
    });
    try {
      const steps = [{ id: 'record', jobName: 'record' }];

      await expect(server.callTool('register_workflow', { name: 'hooked', steps, trigger: 'webhook' })).rejects.toThrow(
        "A workflow registered at runtime can't have trigger: 'webhook'",
      );
      const manual = await server.callTool('register_workflow', { name: 'plain', steps });
      expect(manual.structuredContent).toEqual({ success: true, workflowId: 'plain' });
    } finally {
      await server.dispose();
    }
  });
});

describe('two webhook workflows with one name', () => {
  it('starts a run only for a request signed with the secret of the workflow the name resolves to', async () => {
    const steps = [{ id: 'record', jobName: 'record' }];
    @Workflow({
      name: 'twin',
      trigger: 'webhook',
      webhook: { secret: secretOf('twin-a'), path: '/hooks/twin-a' },
      steps,
    })
    class TwinA {}
    @Workflow({
      name: 'twin',
      trigger: 'webhook',
      webhook: { secret: secretOf('twin-b'), path: '/hooks/twin-b' },
      steps,
    })
    class TwinB {}
    @App({ id: 'twins', name: 'Twins', jobs: [RecordJob], workflows: [TwinA, TwinB] })
    class TwinsApp {}
    const { handler, instance } = await createTestFetchServer({
      info: { name: 'twins', version: '1.0.0' },
      apps: [TwinsApp],
      logging: { level: LogLevel.Off },
    });
    try {
      const signedForA = await handler(signedRequest('/hooks/twin-a', '{}'));
      const signedForB = await handler(signedRequest('/hooks/twin-b', '{}'));

      expect(signedForA.status).toBe(401);
      expect(signedForB.status).toBe(202);
    } finally {
      await instance.shutdown();
    }
  });
});
