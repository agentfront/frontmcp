---
name: create-workflow
description: Connect multiple jobs into managed DAG pipelines with dependencies and conditions, run by execute_workflow or a webhook route
---

# Creating Workflows

Workflows connect multiple jobs into managed execution pipelines with step dependencies and conditions. A workflow defines a directed acyclic graph (DAG) of steps where each step runs a named job, and the framework handles ordering, parallelism and error propagation. A workflow runs when something calls `execute_workflow`: a client, or your own code, such as an `@HttpRoute` that receives a webhook (see [Starting a Workflow](#starting-a-workflow)).

## When to Use This Skill

### Must Use

- Orchestrating multiple jobs in a defined order with explicit step dependencies (e.g., build then test then deploy)
- Building execution pipelines that require conditional branching, parallel fan-out, or diamond dependency patterns
- Multi-step automation that a webhook starts, through an `@HttpRoute` that calls `execute_workflow`

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

| Field            | Type                               | Required    | Default           | Description                                                                                                                                                                                    |
| ---------------- | ---------------------------------- | ----------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | `string`                           | Yes         | --                | Unique workflow name                                                                                                                                                                           |
| `steps`          | `WorkflowStep[]`                   | Yes (min 1) | --                | Array of step definitions                                                                                                                                                                      |
| `description`    | `string`                           | No          | --                | Human-readable description                                                                                                                                                                     |
| `trigger`        | `'manual' \| 'webhook' \| 'event'` | No          | `'manual'`        | **Deprecated, not read**: every workflow runs through `execute_workflow`; `'webhook'` and `'event'` make startup warn (see [Starting a Workflow](#starting-a-workflow))                        |
| `webhook`        | `WebhookConfig`                    | No          | --                | **Deprecated, not read**: registers no HTTP route, and startup warns                                                                                                                           |
| `timeout`        | `number`                           | No          | `600000` (10 min) | Maximum total workflow execution time in milliseconds                                                                                                                                          |
| `maxConcurrency` | `number`                           | No          | `5`               | Maximum number of steps running in parallel                                                                                                                                                    |
| `permissions`    | `JobPermission[]`                  | No          | --                | Array of permission rules. Multiple rules may target the same action; all matching rules must pass. Same shape and semantics as job permissions; **enforced from 1.7.2** (GHSA-58v2-gpcc-jmqv) |

### WorkflowStep Fields

| Field             | Type                                       | Required | Description                                                                 |
| ----------------- | ------------------------------------------ | -------- | --------------------------------------------------------------------------- |
| `id`              | `string`                                   | Yes      | Unique step identifier within the workflow                                  |
| `jobName`         | `string`                                   | Yes      | Name of the registered job to run                                           |
| `input`           | `object \| (steps: StepResults) => object` | No       | Static input object or function that receives previous step results         |
| `dependsOn`       | `string[]`                                 | No       | Array of step IDs that must complete before this step runs (see below)      |
| `condition`       | `(steps: StepResults) => boolean`          | No       | Predicate that determines if the step should run                            |
| `continueOnError` | `boolean`                                  | No       | If `true`, the steps that depend on this one run even if it fails           |
| `timeout`         | `number`                                   | No       | Per-step timeout in milliseconds (overrides workflow timeout for this step) |
| `retry`           | `RetryPolicy`                              | No       | Per-step retry policy (overrides the job's); with neither, one attempt      |

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

Use a function for `input` to pass data from completed steps. The function receives a `StepResults` map where each entry contains the step's state and outputs.

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
  state: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  outputs: Record<string, unknown>; // job output from the completed step
  error?: string; // error message if the step failed
  startedAt?: string;
  completedAt?: string;
}
```

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

## Starting a Workflow

A workflow runs when something calls `execute_workflow` (`{ name, input?, background? }`): an MCP client, a tool or route that calls it with `this.callTool()`, or another in-process caller. `trigger` and `webhook` are accepted but not read: `trigger: 'webhook'` and `webhook` register no HTTP route, and `trigger: 'event'` listens to no event, so startup warns about a workflow that sets them. Up to 1.11.2 they were ignored without a warning.

To start a workflow from a webhook, serve an `@HttpRoute` (see `create-http-route`) that checks the request's signature over `this.request.bodyBytes`, the body as received, and calls `execute_workflow`:

```typescript
import { httpRespond, HttpRoute, HttpRouteContext } from '@frontmcp/sdk';
import { bytesToHex, hmacSha256, timingSafeEqual } from '@frontmcp/utils';

const encoder = new TextEncoder();

@HttpRoute({ method: 'POST', path: '/webhooks/github-deploy', auth: 'public' })
export class GithubDeployWebhook extends HttpRouteContext {
  async handle() {
    const secret = encoder.encode(process.env.WEBHOOK_SECRET ?? '');
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

List the route in the app's `routes`. The route's caller is anonymous, so a workflow it starts must not set `execute` permissions that an anonymous caller fails; the signature check is what protects it.

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
  timeout: 900000, // 15 minutes
  maxConcurrency: 3,
  permissions: [
    { action: 'execute', roles: ['admin', 'ci-bot'] },
    { action: 'create', roles: ['admin', 'ci-bot'] },
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

| Pattern           | Correct                                                                | Incorrect                                                          | Why                                                                             |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Step dependencies | `dependsOn: ['build', 'test']` (array of step IDs)                     | `dependsOn: 'build'` (plain string)                                | `dependsOn` expects a `string[]`, not a single string                           |
| Dynamic input     | `input: (steps) => ({ artifact: steps.get('build').outputs.url })`     | `input: { artifact: buildResult.url }` (captured closure variable) | Static objects cannot reference previous step outputs; use the callback form    |
| Conditional steps | `condition: (steps) => steps.get('test').state === 'completed'`        | `condition: (steps) => steps.get('test').outputs` (truthy check)   | Always check `.state` explicitly; outputs can be truthy even on partial failure |
| Job registration  | Register all referenced jobs in the `jobs` array of `@App`             | Declare `jobName` in steps without registering the job class       | Steps reference jobs by name; unregistered jobs cause runtime lookup failures   |
| Webhook start     | An `@HttpRoute` that checks the signature and calls `execute_workflow` | `trigger: 'webhook'` with a `webhook` config                       | `trigger` and `webhook` register no route; startup warns about them             |

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
- [ ] A webhook route that starts the workflow refuses a bad signature and answers a good one with the run's `runId`

## Troubleshooting

| Problem                                             | Cause                                                                   | Solution                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Step never executes                                 | `dependsOn` references a step ID that does not exist                    | Verify all `dependsOn` entries match actual step `id` values in the workflow                       |
| Workflow fails at startup with "job not found"      | `jobName` references an unregistered job                                | Add the job class to the `jobs` array in `@App` before registering the workflow                    |
| Dynamic `input` callback receives undefined outputs | A step it depends on was skipped, or failed with `continueOnError`      | Add a `condition` guard that checks `steps.get(id).state === 'completed'` before accessing outputs |
| Webhook never starts the workflow                   | `trigger: 'webhook'` and `webhook` register no route (startup warns)    | Serve an `@HttpRoute` that checks the signature and calls `execute_workflow`                       |
| Workflow exceeds timeout                            | Total step execution time exceeds the default 600000 ms                 | Increase `timeout` at the workflow level or add per-step `timeout` overrides                       |
| A failure-notification step never runs              | The step it watches failed without `continueOnError`, so it was skipped | Set `continueOnError: true` on the watched step                                                    |

## Examples

| Example                                                                                       | Level        | Description                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`basic-deploy-pipeline`](../examples/create-workflow/basic-deploy-pipeline.md)               | Basic        | A linear workflow that builds, tests, and deploys a service with step dependencies and dynamic input.                                                        |
| [`parallel-validation-pipeline`](../examples/create-workflow/parallel-validation-pipeline.md) | Intermediate | A workflow that validates multiple datasets in parallel, then conditionally merges results or notifies on failure.                                           |
| [`webhook-triggered-workflow`](../examples/create-workflow/webhook-triggered-workflow.md)     | Advanced     | A CI/CD workflow that an `@HttpRoute` starts from a signed webhook, featuring `continueOnError`, per-step conditions, and the `workflow()` function builder. |

> See all examples in [`examples/create-workflow/`](../examples/create-workflow/)

## Reference

- [Workflows Documentation](https://frontmcp.dev/reference/sdk/workflow)
- Related skills: `create-job`, `create-skill-with-tools`, `create-tool`, `multi-app-composition`
