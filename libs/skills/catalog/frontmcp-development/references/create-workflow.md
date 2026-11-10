---
name: create-workflow
description: Connect multiple jobs into managed DAG pipelines with dependencies, conditions, and triggers
---

# Creating Workflows

Workflows connect multiple jobs into managed execution pipelines with step dependencies, conditions, and triggers. A workflow defines a directed acyclic graph (DAG) of steps where each step runs a named job, and the framework handles ordering, parallelism, error propagation, and trigger management. A workflow runs when something calls `execute_workflow`, or when its trigger fires: a signed webhook request, an event the server emits, or a time of its cron schedule (see [Workflow Triggers](#workflow-triggers)).

## When to Use This Skill

### Must Use

- Orchestrating multiple jobs in a defined order with explicit step dependencies (e.g., build then test then deploy)
- Building execution pipelines that require conditional branching, parallel fan-out, or diamond dependency patterns
- Defining webhook-, event- or schedule-triggered multi-step automation that the framework manages end to end

### Recommended

- CI/CD pipelines, data-processing ETL flows, or approval chains that combine three or more jobs
- Multi-stage provisioning sequences where steps need `continueOnError` or per-step retry policies
- Replacing hand-rolled orchestration code with a declarative DAG of job steps

### Skip When

- You only need a single background task with no inter-step dependencies (see `create-job`)
- You need real-time, AI-guided sequential tool calls rather than pre-declared steps (see `create-skill-with-tools`)
- You are building a conversational prompt template with no execution logic (see `create-prompt`)

> **Decision:** Use this skill when you need a declarative, multi-step pipeline of jobs with dependency ordering, conditions, and managed error propagation.

## Class-Based Pattern

Create a class decorated with `@Workflow`. The decorator requires `name` and `steps` (at least one step).

### WorkflowMetadata Fields

| Field            | Type                                             | Required    | Default             | Description                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------ | ----------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | `string`                                         | Yes         | --                  | Unique workflow name                                                                                                                                                                           |
| `steps`          | `WorkflowStep[]`                                 | Yes (min 1) | --                  | Array of step definitions                                                                                                                                                                      |
| `description`    | `string`                                         | No          | --                  | Human-readable description                                                                                                                                                                     |
| `trigger`        | `'manual' \| 'webhook' \| 'event' \| 'schedule'` | No          | `'manual'`          | What starts a run besides `execute_workflow`: a signed request to its route, its event, or the times of its cron (see [Workflow Triggers](#workflow-triggers))                                 |
| `webhook`        | `WebhookConfig`                                  | No          | --                  | The route of a `trigger: 'webhook'` workflow: `secret` is required; set without that trigger, the server refuses to start                                                                      |
| `event`          | `string`                                         | No          | The workflow's name | The event that starts a `trigger: 'event'` workflow; set without that trigger, the server refuses to start                                                                                     |
| `schedule`       | `WorkflowScheduleConfig`                         | No          | --                  | When a `trigger: 'schedule'` workflow runs: `{ cron, timezone?, input? }`; `cron` is required; set without that trigger, the server refuses to start                                           |
| `timeout`        | `number`                                         | No          | `600000` (10 min)   | Maximum total workflow execution time in milliseconds                                                                                                                                          |
| `maxConcurrency` | `number`                                         | No          | `5`                 | Maximum number of steps running in parallel                                                                                                                                                    |
| `permissions`    | `JobPermission[]`                                | No          | --                  | Array of permission rules. Multiple rules may target the same action; all matching rules must pass. Same shape and semantics as job permissions; **enforced from 1.7.2** (GHSA-58v2-gpcc-jmqv) |
| `inputSchema`    | Zod raw shape                                    | No          | --                  | The workflow's input, checked when a run starts (see [Workflow Input](#workflow-input))                                                                                                        |

### WorkflowStep Fields

| Field             | Type                                         | Required | Description                                                                                                    |
| ----------------- | -------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `id`              | `string`                                     | Yes      | Unique step identifier within the workflow                                                                     |
| `jobName`         | `string`                                     | Yes      | Name of the registered job to run                                                                              |
| `input`           | `object \| (steps, workflowInput) => object` | No       | Static input, or a function of earlier step results and the workflow's input; without it, the workflow's input |
| `dependsOn`       | `string[]`                                   | No       | Array of step IDs that must complete before this step runs (see below)                                         |
| `condition`       | `(steps, workflowInput) => boolean`          | No       | Predicate that determines if the step should run                                                               |
| `continueOnError` | `boolean`                                    | No       | If `true`, the steps that depend on this one run even if it fails                                              |
| `timeout`         | `number`                                     | No       | Per-step timeout in milliseconds (overrides workflow timeout for this step)                                    |
| `retry`           | `RetryPolicy`                                | No       | Per-step retry policy (overrides the job's); with neither, one attempt                                         |

When a step's `timeout` passes, the step fails with `WorkflowJobTimeoutError`. An attempt whose job has not started never starts it. A job already in `execute()` is not stopped: its `this.signal` (`ctx.signal` in a `job()` function) is aborted with the timeout as its reason, so pass it to `fetch` and other cancellable work, or check it. Its attempt's `jobs:execute-job` flow ends as failed at once: `Did('execute')` and `Did('validateOutput')` don't run, the job's `cleanup` runs with `'timeout'`, and the finalize hooks see the `WorkflowJobTimeoutError` as `state.flowError`. Up to 1.10 the flow waited for `execute()` to return first; up to 1.9.4 the flow of such an attempt ran on as a success, so audit and metrics hooks recorded a success for a step the workflow reported as failed. Each step attempt also waits for a slot under `jobs.admission` (see `create-job`). `cancel_job` cancels job runs only: a workflow run is refused with `JOB_RUN_NOT_CANCELLABLE`. A step whose job sets `runner: 'worker'` runs its `execute()` on the offload pool; a job on the `'detached'` runner runs inline as a step, in the workflow's process, since the workflow run owns its steps.

### Basic Example

```typescript
import { Workflow } from '@frontmcp/sdk';

@Workflow({
  name: 'deploy-pipeline',
  description: 'Build, test, and deploy a service',
  steps: [
    {
      id: 'build',
      jobName: 'build-project',
      input: { target: 'production', optimize: true },
    },
    {
      id: 'test',
      jobName: 'run-tests',
      input: { suite: 'all', coverage: true },
      dependsOn: ['build'],
    },
    {
      id: 'deploy',
      jobName: 'deploy-to-env',
      input: (steps) => ({
        artifact: steps.get('build').outputs.artifactUrl,
        environment: 'production',
      }),
      dependsOn: ['test'],
    },
  ],
})
class DeployPipeline {}
```

## Step Dependencies and DAG Execution

Steps form a directed acyclic graph (DAG) based on their `dependsOn` declarations. The framework:

1. Identifies steps with no dependencies and runs them in parallel (up to `maxConcurrency`)
2. As each step completes, checks which dependent steps have all their dependencies satisfied
3. Runs newly unblocked steps in parallel
4. Continues until every step has run or been skipped. A step that fails (without `continueOnError`) skips every step that depends on it, directly or not; the steps that don't depend on it still run, and the run ends `failed`

A step is tried as many times as its `retry` says, else its job's `retry`; with neither it is tried once, as `execute_job` runs the job. Up to 1.11.2 a step whose job had no `retry` was tried 3 times, and a failed step skipped only the steps that named it in `dependsOn`: their own dependents still ran.

### Parallel Steps

Steps without mutual dependencies run concurrently:

```typescript
@Workflow({
  name: 'data-validation-pipeline',
  description: 'Validate data from multiple sources in parallel, then merge',
  maxConcurrency: 3,
  steps: [
    // These three steps have no dependencies -- they run in parallel
    {
      id: 'validate-users',
      jobName: 'validate-dataset',
      input: { dataset: 'users', rules: ['no-nulls', 'email-format'] },
    },
    {
      id: 'validate-orders',
      jobName: 'validate-dataset',
      input: { dataset: 'orders', rules: ['no-nulls', 'positive-amounts'] },
    },
    {
      id: 'validate-products',
      jobName: 'validate-dataset',
      input: { dataset: 'products', rules: ['no-nulls', 'unique-sku'] },
    },
    // This step depends on all three -- runs after all complete
    {
      id: 'merge-results',
      jobName: 'merge-validations',
      dependsOn: ['validate-users', 'validate-orders', 'validate-products'],
      input: (steps) => ({
        userReport: steps.get('validate-users').outputs,
        orderReport: steps.get('validate-orders').outputs,
        productReport: steps.get('validate-products').outputs,
      }),
    },
  ],
})
class DataValidationPipeline {}
```

### Diamond Dependencies

Steps can share dependencies, forming diamond patterns:

```typescript
@Workflow({
  name: 'build-and-publish',
  description: 'Build artifacts and publish to multiple registries',
  steps: [
    { id: 'compile', jobName: 'compile-source', input: { target: 'es2022' } },
    {
      id: 'publish-npm',
      jobName: 'publish-to-registry',
      dependsOn: ['compile'],
      input: (steps) => ({ artifact: steps.get('compile').outputs.bundlePath, registry: 'npm' }),
    },
    {
      id: 'publish-docker',
      jobName: 'publish-to-registry',
      dependsOn: ['compile'],
      input: (steps) => ({ artifact: steps.get('compile').outputs.bundlePath, registry: 'docker' }),
    },
    {
      id: 'notify',
      jobName: 'send-notification',
      dependsOn: ['publish-npm', 'publish-docker'],
      input: (steps) => ({
        message: `Published to npm (${steps.get('publish-npm').outputs.version}) and Docker (${steps.get('publish-docker').outputs.tag})`,
      }),
    },
  ],
})
class BuildAndPublish {}
```

## Dynamic Input from Previous Steps

Use a function for `input` to pass data from completed steps. The function receives a `StepResults` map where each entry contains the step's state and outputs, and the workflow's input as its second argument (see [Workflow Input](#workflow-input)).

```typescript
{
  id: 'transform',
  jobName: 'transform-data',
  dependsOn: ['extract'],
  input: (steps) => ({
    data: steps.get('extract').outputs.records,
    schema: steps.get('extract').outputs.schema,
    rowCount: steps.get('extract').outputs.count,
  }),
}
```

The `steps.get(stepId)` method returns a step result object:

```typescript
interface StepResult {
  state: 'completed' | 'failed' | 'skipped';
  outputs: Record<string, unknown>; // job output from the completed step; {} when it failed or was skipped
}
```

## Workflow Input

A run's input is what `execute_workflow` passes as `input`. Declare `inputSchema` (a Zod raw shape, as for a job) to check it when the run starts: input that doesn't match fails with `INVALID_INPUT` (`Invalid input for workflow "<name>"`, with the issues), after the `execute` permissions and before the run exists. The parsed input, with defaults applied and unknown keys dropped, is what the steps see:

- a step without `input` gets the workflow's input as its job's input;
- a step's `input` and `condition` functions receive it as their second argument.

```typescript
@Workflow({
  name: 'release',
  inputSchema: {
    version: z.string(),
    dryRun: z.boolean().default(false),
  },
  steps: [
    { id: 'build', jobName: 'build-project' }, // gets { version, dryRun }
    {
      id: 'publish',
      jobName: 'publish-to-registry',
      dependsOn: ['build'],
      condition: (steps, input) => input.dryRun !== true,
      input: (steps, input) => ({ artifact: steps.get('build').outputs.bundlePath, tag: input.version }),
    },
  ],
})
class Release {}
```

Without `inputSchema`, the input is passed on as given. Up to 1.11.2 `inputSchema` wasn't checked, and `input` and `condition` functions received only the step results.

## Conditional Steps

Use `condition` to conditionally run a step based on the results of previous steps. The condition receives the same `StepResults` map.

```typescript
@Workflow({
  name: 'conditional-deploy',
  description: 'Deploy only if tests pass and coverage meets threshold',
  steps: [
    {
      id: 'test',
      jobName: 'run-tests',
      input: { suite: 'all', coverage: true },
      continueOnError: true, // lets notify-failure run when the tests fail
    },
    {
      id: 'deploy',
      jobName: 'deploy-to-env',
      dependsOn: ['test'],
      condition: (steps) => {
        const testResult = steps.get('test');
        return testResult.state === 'completed' && testResult.outputs.coverage >= 95;
      },
      input: (steps) => ({
        artifact: steps.get('test').outputs.buildPath,
        environment: 'staging',
      }),
    },
    {
      id: 'notify-failure',
      jobName: 'send-notification',
      dependsOn: ['test'],
      condition: (steps) => steps.get('test').state === 'failed',
      input: { channel: '#alerts', message: 'Test suite failed -- deployment blocked' },
    },
  ],
})
class ConditionalDeploy {}
```

When a `condition` returns `false`, the step is marked as `skipped`. Downstream steps that depend on a skipped step check their own conditions with the skipped step's state. A step that depends on a failed step is skipped without its `condition` being called, so a step that reacts to a failure (`notify-failure` here) needs `continueOnError: true` on the step it watches.

## Error Handling with continueOnError

By default, a failed step skips every step that depends on it, directly or not, and the run ends `failed`; steps that don't depend on it still run. Set `continueOnError: true` on a step to let the steps that depend on it run even if it fails: they see its `state` as `'failed'`.

```typescript
@Workflow({
  name: 'resilient-pipeline',
  description: 'Pipeline that continues past non-critical failures',
  steps: [
    {
      id: 'extract',
      jobName: 'extract-data',
      input: { source: 'primary-db' },
    },
    {
      id: 'enrich',
      jobName: 'enrich-data',
      dependsOn: ['extract'],
      continueOnError: true, // enrichment is optional
      input: (steps) => ({ data: steps.get('extract').outputs.records }),
    },
    {
      id: 'load',
      jobName: 'load-data',
      dependsOn: ['extract', 'enrich'],
      input: (steps) => {
        const enrichResult = steps.get('enrich');
        // Use enriched data if available, fall back to raw
        const data =
          enrichResult.state === 'completed'
            ? enrichResult.outputs.enrichedRecords
            : steps.get('extract').outputs.records;
        return { data, destination: 'warehouse' };
      },
    },
  ],
})
class ResilientPipeline {}
```

## Workflow Triggers

Every workflow runs when something calls `execute_workflow` (`{ name, input?, background? }`): an MCP client, a tool or route that calls it with `this.callTool()`, or another in-process caller. Its `trigger` adds another way to start it.

### Manual (Default)

Nothing else starts the workflow:

```typescript
@Workflow({
  name: 'manual-deploy',
  description: 'Manually triggered deployment',
  trigger: 'manual',
  steps: [
    /* ... */
  ],
})
class ManualDeploy {}
```

### Webhook

The server serves an HTTP route for the workflow, and a request signed with its `webhook.secret` starts a run in the background, with the request's JSON body as the run's input:

```typescript
@Workflow({
  name: 'ci-deploy',
  description: 'Deploy when the CI pipeline posts a signed build event',
  trigger: 'webhook',
  webhook: {
    path: '/webhooks/ci-deploy',
    secret: process.env.CI_DEPLOY_WEBHOOK_SECRET,
    methods: ['POST'],
  },
  inputSchema: { branch: z.string(), commitSha: z.string() },
  permissions: [{ action: 'execute', roles: ['admin', 'webhook:ci-deploy'] }],
  steps: [
    { id: 'build', jobName: 'build-project' }, // gets { branch, commitSha }
    {
      id: 'deploy',
      jobName: 'deploy-to-env',
      dependsOn: ['build'],
      input: (steps) => ({ artifact: steps.get('build').outputs.artifactUrl, environment: 'production' }),
    },
  ],
})
class CiDeploy {}
```

#### WebhookConfig Fields

| Field          | Type                  | Default                     | Description                                                                                                          |
| -------------- | --------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `secret`       | `string`              | --                          | **Required**, at least 32 characters, and not shared with another webhook workflow; else the server refuses to start |
| `path`         | `string`              | `/workflows/webhook/{name}` | The route's path: literal segments only, no `:name` parameter                                                        |
| `methods`      | `('GET' \| 'POST')[]` | `['POST']`                  | The methods the route answers; another method gets 404. A GET has no body, so its run's input is `{}`                |
| `maxBodyBytes` | `number`              | `1048576` (1 MiB)           | The largest body accepted; a larger one gets 413                                                                     |

#### Signing a Request

Each request carries two headers, signed with the workflow's secret:

- `X-FrontMCP-Timestamp`: the time of signing, in Unix seconds;
- `X-FrontMCP-Signature`: `v1=` and the hex HMAC-SHA256, keyed with the secret, of the timestamp, a `.`, and the body's bytes exactly as sent (`<timestamp>.<body>`; for a GET, `<timestamp>.`).

The server refuses a timestamp more than 5 minutes from its clock, either way, and a signature it already accepted, so each signed request starts one run: to retry, sign again. It compares signatures in constant time. It remembers the signatures it accepted in its own process, so behind several instances a request replayed to another one within the 5 minutes isn't caught; keep the secret, and the requests, on TLS.

```bash
body='{"branch":"main","commitSha":"4f2a9c1"}'
timestamp=$(date +%s)
signature=$(printf '%s.%s' "$timestamp" "$body" | openssl dgst -sha256 -hmac "$CI_DEPLOY_WEBHOOK_SECRET" -r | cut -d' ' -f1)
curl -X POST https://mcp.example.com/webhooks/ci-deploy \
  -H 'Content-Type: application/json' \
  -H "X-FrontMCP-Timestamp: $timestamp" \
  -H "X-FrontMCP-Signature: v1=$signature" \
  --data-binary "$body"
```

```typescript
// The same, from Node.js
import { createHmac } from 'node:crypto';

const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-FrontMCP-Timestamp': timestamp,
    'X-FrontMCP-Signature': `v1=${signature}`,
  },
  body,
});
```

#### What the Route Answers

The route runs through the `http:route` flow, like an `@HttpRoute`: the `throttle.ipFilter` check, the global rate limit, and the same-origin check a browser's mutation gets, before any of these:

| Status | Body                               | When                                                                                                                               |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `202`  | `{ runId, state: 'pending' }`      | The run started, as `execute_workflow` answers a background run                                                                    |
| `415`  | `{ error }`                        | A POST whose `Content-Type` isn't `application/json`                                                                               |
| `413`  | `{ error: 'Payload too large' }`   | The body is larger than `maxBodyBytes`                                                                                             |
| `401`  | `{ error: 'Unauthorized' }`        | Unsigned, malformed, outside the 5 minutes, a wrong signature, or sent before: always the same answer; the server's log says which |
| `400`  | `{ error }` or `{ error, issues }` | A signed body that isn't a JSON object, or that doesn't match the workflow's `inputSchema`                                         |
| `403`  | `{ error: 'Forbidden' }`           | The workflow's `create` or `execute` rules don't allow `webhook:<workflow>`                                                        |

#### Who the Run Runs As

A webhook's caller isn't signed in, so its run runs as the role `webhook:<workflow name>`, and nothing else: no subject, scopes or claims, whatever `authorities.claimsMapping` says. Only the server can give a run that identity. A webhook submits a run, so the workflow's `create` and `execute` rules both apply. A workflow without them runs for any signed request. One with them must allow the role, in the same rule as the people who may run it, since every rule for an action must pass:

```typescript
permissions: [
  { action: 'execute', roles: ['admin', 'webhook:ci-deploy'] },
  { action: 'create', roles: ['admin', 'webhook:ci-deploy'] },
],
```

Each step's job checks its own `execute` rules against the same role, so a step job with rules must allow it too, or that step fails. A `custom` rule can read the identity as `authInfo.extra.workflowTrigger` (`{ kind: 'webhook', name, role }`). The run has no owner: who may read it with `get_workflow_status` is up to the workflow's `read` rules.

Up to 1.11.2, `trigger: 'webhook'` and `webhook` registered no route: they were ignored.

#### Alternative: an `@HttpRoute`

A sender that signs its own way, such as a GitHub webhook (`X-Hub-Signature-256`, an HMAC over the body alone), can't call the trigger. Serve it an `@HttpRoute` (see `create-http-route`) that checks its signature over `this.request.bodyBytes`, the body as received, and calls `execute_workflow`:

```typescript
import { httpRespond, HttpRoute, HttpRouteContext } from '@frontmcp/sdk';
import { bytesToHex, hmacSha256, timingSafeEqual } from '@frontmcp/utils';

const encoder = new TextEncoder();

@HttpRoute({ method: 'POST', path: '/webhooks/github-deploy', auth: 'public' })
export class GithubDeployWebhook extends HttpRouteContext {
  async handle() {
    const secret = encoder.encode(process.env.GITHUB_WEBHOOK_SECRET ?? '');
    const body = this.request.bodyBytes ?? new Uint8Array();
    const expected = encoder.encode(`sha256=${bytesToHex(hmacSha256(secret, body))}`);
    const signature = encoder.encode(this.request.headers['x-hub-signature-256'] ?? '');
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      return httpRespond.unauthorized({ body: { error: 'Bad signature' } });
    }
    const run = await this.callTool('execute_workflow', { name: 'github-deploy', background: true });
    return run.structuredContent; // { runId, state: 'pending' }
  }
}
```

List the route in the app's `routes`, and leave the workflow's `trigger` unset. The route calls `execute_workflow` as an anonymous caller, so the workflow must not set `execute` rules that an anonymous caller fails; the route's signature check is what protects it.

### Event

The workflow starts when the server emits its `event` (default: the workflow's name) on the scope's event bus, the in-process bus `app-event` channel sources listen on too. Your code emits it from a tool, a job, a hook or a provider with `this.scope.channelEventBus?.emit(event, payload)`, and each workflow listening to that event starts a run in the background, with the payload as its input:

```typescript
@Workflow({
  name: 'on-user-signup',
  description: 'Workflow triggered when a new user signs up',
  trigger: 'event',
  event: 'user.signup',
  inputSchema: { userId: z.string(), email: z.string() },
  permissions: [{ action: 'execute', roles: ['admin', 'event:user.signup'] }],
  steps: [
    {
      id: 'create-profile',
      jobName: 'create-user-profile',
      input: (steps, input) => ({ userId: input.userId, template: 'default' }),
    },
    {
      id: 'send-welcome',
      jobName: 'send-email',
      dependsOn: ['create-profile'],
      input: (steps, input) => ({ to: input.email, template: 'welcome' }),
    },
    {
      id: 'setup-defaults',
      jobName: 'setup-user-defaults',
      dependsOn: ['create-profile'],
      input: (steps, input) => ({ userId: input.userId }),
    },
  ],
})
class OnUserSignup {}

@Tool({ name: 'sign_up', inputSchema: { email: z.string() } })
class SignUpTool extends ToolContext {
  async execute({ email }: { email: string }) {
    const userId = await this.get(Users).create(email);
    this.scope.channelEventBus?.emit('user.signup', { userId, email });
    return { userId };
  }
}
```

- **The bus** exists when a workflow has `trigger: 'event'` or `channels.enabled` is set; else `channelEventBus` is `undefined`. It is in-process: an event emitted in one server process starts the workflows of that process, and a detached job runner listens to none.
- **The payload** is the run's input, checked against the workflow's `inputSchema`. No payload starts the run with `{}`. A payload that isn't an object, or doesn't match the schema, starts no run.
- **Who the run runs as**: the role `event:<event>`, and nothing else, as a webhook's run runs as `webhook:<workflow>` (see [Who the Run Runs As](#who-the-run-runs-as)). A workflow with `create` or `execute` rules must allow it, and so must each step job with `execute` rules.
- **`emit()` doesn't wait** for the run, and nothing it does throws at the emitter: a run that can't start (a denial, bad input) is logged as a warning that names the event, the workflow and the reason.
- A job of the run that emits the event that started it starts another run.

Up to 1.11.2, `trigger: 'event'` listened to no event: it was ignored.

### Schedule

The workflow starts at each time of its `schedule.cron`, in the background, with `schedule.input` as its input:

```typescript
@Workflow({
  name: 'weekday-digest',
  description: 'Sends the digest every weekday morning',
  trigger: 'schedule',
  schedule: { cron: '0 9 * * 1-5', timezone: 'Europe/Berlin', input: { audience: 'team' } },
  inputSchema: { audience: z.string() },
  permissions: [{ action: 'execute', roles: ['admin', 'schedule:weekday-digest'] }],
  steps: [
    { id: 'collect', jobName: 'collect-updates' },
    {
      id: 'send',
      jobName: 'send-email',
      dependsOn: ['collect'],
      input: (steps, input) => ({ to: input.audience, body: steps.get('collect').outputs.summary }),
    },
  ],
})
class WeekdayDigest {}
```

| Field      | Type     | Default  | Description                                                                                       |
| ---------- | -------- | -------- | ------------------------------------------------------------------------------------------------- |
| `cron`     | `string` | Required | A cron expression: `minute hour day-of-month month day-of-week`, or six fields with seconds first |
| `timezone` | `string` | `'UTC'`  | The IANA time zone `cron` is read in, such as `'Europe/Berlin'`                                   |
| `input`    | `object` | `{}`     | The input of each scheduled run, checked against the workflow's `inputSchema`                     |

- **The expression** is the one `@Duty({ cron })` takes (see `create-duty`, Cron Schedules): lists, ranges, steps, month and day names, `@daily`-style nicknames, and the same handling of daylight saving time. One that can't be read refuses to start the server: `Workflow "<name>": schedule.cron "<cron>" can't be read: <reason>`. So does a time zone the runtime doesn't know: `Workflow "<name>": schedule.timezone "<zone>" is not an IANA time zone such as "Europe/Berlin"`. So does `trigger: 'schedule'` without a `schedule`, and a `schedule` on a workflow with another trigger.
- **One run at a time it comes**, whatever the number of server processes (times missed while no process held the lease are caught up as one run: see Catching up). Each schedule has a lease that one process holds, as a `@Duty` has: among every machine that shares the server's top-level `redis` (key `frontmcp:cluster:schedule:<info.name>:<workflow>`), or, without one, among the processes of the machine that run from the same project root (the nearest `package.json`), in the SQLite file `~/.frontmcp/duties.sqlite` (key `frontmcp:schedule:<info.name>:<workflow>:<hash of the project root>`; it needs `@frontmcp/storage-sqlite`). Two unrelated servers on one machine with the same `info.name` therefore keep separate schedules. When the holder exits, another process takes the schedule over at its next check; when it dies, within the 60 s lease plus a third of it.
- **Catching up**: the workflow doesn't run when the server starts. The store keeps the time the schedule was last taken; a process that gets the lease after a restart or a takeover starts one run if a scheduled time passed since, whatever the number missed, then continues on schedule.
- **Overlap**: a scheduled time starts its run even while the run of the last one is still going. Pick a cron with gaps longer than a run, or make the jobs safe to run side by side.
- **Who the run runs as**: the role `schedule:<workflow name>`, and nothing else, as a webhook's run runs as `webhook:<workflow>` (see [Who the Run Runs As](#who-the-run-runs-as)). A workflow with `create` or `execute` rules must allow it, and so must each step job with `execute` rules. A `custom` rule reads it as `authInfo.extra.workflowTrigger` (`{ kind: 'schedule', name, role }`).
- **A run that can't start** (a denial, an `input` that doesn't match the `inputSchema`) is logged as a warning, `The schedule did not start workflow "<name>": <reason>`, and the next scheduled time tries again. A schedule whose lease store can't be opened logs `The schedule of workflow "<name>" did not start: <cause>`.
- **Where it runs**: schedules start once the server serves, in a process that stays up (see `create-worker`, Keeping a Worker Alive). They don't start in a serverless or edge deployment (`Scheduled workflows ("<name>") do not run in a serverless or edge deployment: they need a long-lived process`), in a detached job runner, or when `frontmcp build` boots the server to read it.
- A workflow registered at runtime (`register_workflow`) can't have `trigger: 'schedule'`: declare it with `@Workflow`.

## Function Builder

For workflows that do not need a class, use the `workflow()` function builder:

```typescript
import { workflow } from '@frontmcp/sdk';

const QuickDeploy = workflow({
  name: 'quick-deploy',
  description: 'Simplified deployment workflow',
  steps: [
    {
      id: 'build',
      jobName: 'build-project',
      input: { target: 'production' },
    },
    {
      id: 'deploy',
      jobName: 'deploy-to-env',
      dependsOn: ['build'],
      input: (steps) => ({
        artifact: steps.get('build').outputs.artifactUrl,
        environment: 'staging',
      }),
    },
  ],
});
```

Register it the same way as a class workflow: `workflows: [QuickDeploy]`.

## Registration

Add workflow classes (or function-style workflows) to the `workflows` array in `@App`. Workflows require jobs to be enabled since each step runs a named job.

```typescript
import { App, FrontMcp } from '@frontmcp/sdk';

@App({
  name: 'pipeline-app',
  jobs: [BuildProjectJob, RunTestsJob, DeployToEnvJob, SendNotificationJob],
  workflows: [DeployPipeline, DataValidationPipeline, QuickDeploy],
})
class PipelineApp {}

@FrontMcp({
  info: { name: 'pipeline-server', version: '1.0.0' },
  apps: [PipelineApp],
  jobs: {
    enabled: true,
    store: {
      redis: {
        provider: 'redis',
        host: 'localhost',
        port: 6379,
        keyPrefix: 'mcp:jobs:',
      },
    },
  },
})
class PipelineServer {}
```

## Nx Generator

Scaffold a new workflow using the Nx generator:

```bash
nx generate @frontmcp/nx:workflow
```

This creates the workflow file, spec file, and updates barrel exports.

## Complete Example: CI/CD Pipeline

```typescript
import { App, FrontMcp, Job, JobContext, Workflow, workflow, z } from '@frontmcp/sdk';

// --- Jobs ---

@Job({
  name: 'checkout-code',
  description: 'Checkout code from repository',
  inputSchema: {
    repo: z.string().describe('Repository URL'),
    branch: z.string().default('main'),
  },
  outputSchema: {
    workDir: z.string(),
    commitSha: z.string(),
  },
})
class CheckoutCodeJob extends JobContext {
  async execute(input: { repo: string; branch: string }) {
    this.log(`Checking out ${input.repo}@${input.branch}`);
    return { workDir: '/tmp/build/workspace', commitSha: 'abc123' };
  }
}

@Job({
  name: 'run-linter',
  description: 'Run linter on codebase',
  inputSchema: {
    workDir: z.string(),
  },
  outputSchema: {
    passed: z.boolean(),
    issues: z.number().int(),
  },
})
class RunLinterJob extends JobContext {
  async execute(input: { workDir: string }) {
    this.log(`Linting ${input.workDir}`);
    return { passed: true, issues: 0 };
  }
}

@Job({
  name: 'run-unit-tests',
  description: 'Run unit test suite',
  inputSchema: {
    workDir: z.string(),
    coverage: z.boolean().default(true),
  },
  outputSchema: {
    passed: z.boolean(),
    testCount: z.number().int(),
    coverage: z.number(),
  },
  retry: { maxAttempts: 2, backoffMs: 3000, backoffMultiplier: 1, maxBackoffMs: 3000 },
})
class RunUnitTestsJob extends JobContext {
  async execute(input: { workDir: string; coverage: boolean }) {
    this.log(`Running unit tests in ${input.workDir}`);
    this.progress(50, 100, 'Tests running');
    return { passed: true, testCount: 342, coverage: 96.4 };
  }
}

@Job({
  name: 'build-artifact',
  description: 'Build production artifact',
  inputSchema: {
    workDir: z.string(),
    commitSha: z.string(),
  },
  outputSchema: {
    artifactUrl: z.string().url(),
    size: z.number().int(),
  },
  timeout: 180000,
})
class BuildArtifactJob extends JobContext {
  async execute(input: { workDir: string; commitSha: string }) {
    this.log(`Building artifact from ${input.commitSha}`);
    this.progress(0, 100, 'Compiling');
    this.progress(100, 100, 'Build complete');
    return {
      artifactUrl: `https://artifacts.example.com/builds/${input.commitSha}.tar.gz`,
      size: 52428800,
    };
  }
}

@Job({
  name: 'deploy-artifact',
  description: 'Deploy artifact to target environment',
  inputSchema: {
    artifactUrl: z.string().url(),
    environment: z.string(),
  },
  outputSchema: {
    deploymentId: z.string(),
    url: z.string().url(),
  },
  retry: { maxAttempts: 3, backoffMs: 5000, backoffMultiplier: 2, maxBackoffMs: 30000 },
  permissions: [{ action: 'execute', roles: ['admin', 'deployer'], scopes: ['deploy:write'] }],
})
class DeployArtifactJob extends JobContext {
  async execute(input: { artifactUrl: string; environment: string }) {
    this.log(`Deploying ${input.artifactUrl} to ${input.environment}`);
    return {
      deploymentId: 'deploy-001',
      url: `https://${input.environment}.example.com`,
    };
  }
}

@Job({
  name: 'notify-team',
  description: 'Send notification to the team',
  inputSchema: {
    channel: z.string(),
    message: z.string(),
  },
  outputSchema: {
    sent: z.boolean(),
  },
})
class NotifyTeamJob extends JobContext {
  async execute(input: { channel: string; message: string }) {
    this.log(`Notifying ${input.channel}: ${input.message}`);
    return { sent: true };
  }
}

// --- Workflow ---

@Workflow({
  name: 'ci-cd-pipeline',
  description: 'Full CI/CD pipeline: checkout, lint, test, build, deploy, notify',
  trigger: 'webhook',
  webhook: {
    path: '/webhooks/ci-cd',
    secret: process.env.CI_WEBHOOK_SECRET,
    methods: ['POST'],
  },
  timeout: 900000, // 15 minutes
  maxConcurrency: 3,
  permissions: [
    { action: 'execute', roles: ['admin', 'ci-bot', 'webhook:ci-cd-pipeline'] },
    { action: 'create', roles: ['admin', 'ci-bot', 'webhook:ci-cd-pipeline'] },
    { action: 'read', roles: ['admin', 'ci-bot'] },
    { action: 'list', roles: ['admin', 'ci-bot'] },
  ],
  steps: [
    {
      id: 'checkout',
      jobName: 'checkout-code',
      input: { repo: 'https://github.com/org/repo.git', branch: 'main' },
    },
    {
      id: 'lint',
      jobName: 'run-linter',
      dependsOn: ['checkout'],
      continueOnError: true, // build and notify-failure check its state
      input: (steps) => ({
        workDir: steps.get('checkout').outputs.workDir,
      }),
    },
    {
      id: 'test',
      jobName: 'run-unit-tests',
      dependsOn: ['checkout'],
      continueOnError: true, // build and notify-failure check its state
      input: (steps) => ({
        workDir: steps.get('checkout').outputs.workDir,
        coverage: true,
      }),
    },
    {
      id: 'build',
      jobName: 'build-artifact',
      dependsOn: ['lint', 'test'],
      condition: (steps) =>
        steps.get('lint').state === 'completed' &&
        steps.get('lint').outputs.passed === true &&
        steps.get('test').state === 'completed' &&
        steps.get('test').outputs.passed === true &&
        steps.get('test').outputs.coverage >= 95,
      input: (steps) => ({
        workDir: steps.get('checkout').outputs.workDir,
        commitSha: steps.get('checkout').outputs.commitSha,
      }),
    },
    {
      id: 'deploy',
      jobName: 'deploy-artifact',
      dependsOn: ['build'],
      condition: (steps) => steps.get('build').state === 'completed',
      input: (steps) => ({
        artifactUrl: steps.get('build').outputs.artifactUrl,
        environment: 'staging',
      }),
    },
    {
      id: 'notify-success',
      jobName: 'notify-team',
      dependsOn: ['deploy'],
      condition: (steps) => steps.get('deploy').state === 'completed',
      input: (steps) => ({
        channel: '#deployments',
        message: `Deployed ${steps.get('deploy').outputs.deploymentId} to ${steps.get('deploy').outputs.url}`,
      }),
    },
    {
      id: 'notify-failure',
      jobName: 'notify-team',
      dependsOn: ['lint', 'test'],
      condition: (steps) => steps.get('lint').state === 'failed' || steps.get('test').state === 'failed',
      input: {
        channel: '#alerts',
        message: 'CI pipeline failed -- check lint and test results',
      },
    },
  ],
})
class CiCdPipeline {}

// --- Registration ---

@App({
  name: 'ci-app',
  jobs: [CheckoutCodeJob, RunLinterJob, RunUnitTestsJob, BuildArtifactJob, DeployArtifactJob, NotifyTeamJob],
  workflows: [CiCdPipeline],
})
class CiApp {}

@FrontMcp({
  info: { name: 'ci-server', version: '1.0.0' },
  apps: [CiApp],
  jobs: {
    enabled: true,
    store: {
      redis: {
        provider: 'redis',
        host: 'localhost',
        port: 6379,
        keyPrefix: 'mcp:ci:',
      },
    },
  },
})
class CiServer {}
```

## Common Patterns

| Pattern              | Correct                                                                                                    | Incorrect                                                                  | Why                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Step dependencies    | `dependsOn: ['build', 'test']` (array of step IDs)                                                         | `dependsOn: 'build'` (plain string)                                        | `dependsOn` expects a `string[]`, not a single string                                                 |
| Dynamic input        | `input: (steps) => ({ artifact: steps.get('build').outputs.url })`                                         | `input: { artifact: buildResult.url }` (captured closure variable)         | Static objects cannot reference previous step outputs; use the callback form                          |
| Conditional steps    | `condition: (steps) => steps.get('test').state === 'completed'`                                            | `condition: (steps) => steps.get('test').outputs` (truthy check)           | Always check `.state` explicitly; outputs can be truthy even on partial failure                       |
| Job registration     | Register all referenced jobs in the `jobs` array of `@App`                                                 | Declare `jobName` in steps without registering the job class               | Steps reference jobs by name; unregistered jobs cause runtime lookup failures                         |
| Workflow trigger     | Set `trigger: 'webhook'` and provide `webhook: { path, secret }`                                           | Set `trigger: 'webhook'` without a `webhook.secret`                        | The server refuses to start a webhook workflow without its secret                                     |
| Webhook execute rule | `roles: ['admin', 'webhook:ci-deploy']` in one `execute` rule                                              | `{ roles: ['admin'] }` and `{ roles: ['webhook:ci-deploy'] }` as two rules | Every matching rule must pass, so two rules allow nobody                                              |
| Emitting an event    | `this.scope.channelEventBus?.emit('user.signup', { userId })`                                              | `emit('user.signup', userId)` (a string payload)                           | The payload is the run's input, so it must be an object                                               |
| Scheduled workflow   | `trigger: 'schedule'` with `schedule: { cron, timezone }` and `schedule:<workflow>` in its `execute` roles | A `setInterval()` that calls `execute_workflow` in every server process    | A schedule starts one run for each scheduled time among all processes, and catches up after a restart |

## Verification Checklist

### Configuration

- [ ] `@Workflow` decorator has `name` and at least one step in `steps`
- [ ] Every `jobName` in steps matches a registered `@Job` name
- [ ] `dependsOn` arrays reference valid step `id` values within the same workflow
- [ ] No circular dependencies exist in the step DAG

### Runtime

- [ ] Workflow appears in the server's workflow registry after startup
- [ ] Steps with no dependencies execute in parallel (up to `maxConcurrency`)
- [ ] Conditional steps are correctly skipped or executed based on prior step results
- [ ] `continueOnError: true` steps allow downstream steps to proceed on failure
- [ ] A signed request to the webhook's path answers `202` with the run's `runId`, and an unsigned one `401`
- [ ] Emitting an event-triggered workflow's event starts a run of it
- [ ] A schedule-triggered workflow logs `The schedule of workflow "<name>" runs in this process on cron ...` in one
      server process, and starts a run at its next scheduled time

## Troubleshooting

| Problem                                                    | Cause                                                                                                                                      | Solution                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step never executes                                        | `dependsOn` references a step ID that does not exist                                                                                       | Verify all `dependsOn` entries match actual step `id` values in the workflow                                                                            |
| Workflow fails at startup with "job not found"             | `jobName` references an unregistered job                                                                                                   | Add the job class to the `jobs` array in `@App` before registering the workflow                                                                         |
| Dynamic `input` callback receives undefined outputs        | A step it depends on was skipped, or failed with `continueOnError`                                                                         | Add a `condition` guard that checks `steps.get(id).state === 'completed'` before accessing outputs                                                      |
| Webhook answers `401`                                      | The signature doesn't cover the exact body sent, the timestamp is more than 5 minutes off, or the request was sent before                  | Sign `<timestamp>.<body>` over the bytes you send, with a fresh timestamp for each request; the server's log names the reason                           |
| Webhook answers `403`                                      | The workflow's `create` or `execute` rules don't allow its webhook                                                                         | Add `webhook:<workflow name>` to the roles of those rules                                                                                               |
| Server refuses to start: `needs webhook.secret`            | A `trigger: 'webhook'` workflow without a secret (an unset env var)                                                                        | Set the secret, at least 32 characters (`openssl rand -hex 32`), one for each webhook workflow                                                          |
| An event starts no run                                     | The bus has no listener for that name, or the run can't start                                                                              | Check the workflow's `event` (default: its name); the server's log names a denial or bad input                                                          |
| Server refuses to start: `schedule.cron ... can't be read` | A `trigger: 'schedule'` workflow whose cron is malformed, has a year field, or never matches a date                                        | Fix the expression: 5 fields, or 6 with seconds first                                                                                                   |
| A schedule starts no run                                   | The workflow's rules don't allow `schedule:<workflow name>`, the input doesn't match the `inputSchema`, or the lease store can't be opened | The server's log names the reason; add the role to the `create` and `execute` rules, or install `@frontmcp/storage-sqlite` (or set a top-level `redis`) |
| A scheduled workflow runs an hour off                      | The cron is read in UTC                                                                                                                    | Set `schedule.timezone` to the IANA zone the schedule is meant in                                                                                       |
| Workflow exceeds timeout                                   | Total step execution time exceeds the default 600000 ms                                                                                    | Increase `timeout` at the workflow level or add per-step `timeout` overrides                                                                            |
| `Invalid input for workflow "<name>"`                      | The run's input doesn't match the workflow's `inputSchema`                                                                                 | Pass `input` that matches it; the error's details name each field that doesn't                                                                          |
| A failure-notification step never runs                     | The step it watches failed without `continueOnError`, so it was skipped                                                                    | Set `continueOnError: true` on the watched step                                                                                                         |

## Examples

| Example                                                                                       | Level        | Description                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-deploy-pipeline`](../examples/create-workflow/basic-deploy-pipeline.md)               | Basic        | A linear workflow that builds, tests, and deploys a service with step dependencies and dynamic input.                                    |
| [`parallel-validation-pipeline`](../examples/create-workflow/parallel-validation-pipeline.md) | Intermediate | A workflow that validates multiple datasets in parallel, then conditionally merges results or notifies on failure.                       |
| [`webhook-triggered-workflow`](../examples/create-workflow/webhook-triggered-workflow.md)     | Advanced     | A CI/CD workflow triggered by a signed webhook, featuring `continueOnError`, per-step conditions, and the `workflow()` function builder. |

> See all examples in [`examples/create-workflow/`](../examples/create-workflow/)

## Reference

- [Workflows Documentation](https://frontmcp.dev/reference/sdk/workflow)
- Related skills: `create-job`, `create-skill-with-tools`, `create-tool`, `multi-app-composition`
