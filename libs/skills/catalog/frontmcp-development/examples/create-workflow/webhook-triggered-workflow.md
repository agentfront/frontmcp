---
name: webhook-triggered-workflow
reference: create-workflow
level: advanced
description: 'A CI/CD workflow that an `@HttpRoute` starts from a signed webhook, featuring `continueOnError`, per-step conditions, and the `workflow()` function builder.'
tags: [development, workflow, webhook, triggered]
features:
  - 'An `@HttpRoute` that checks an HMAC signature over the body as received and starts the workflow with `execute_workflow`'
  - 'Using `continueOnError: true` to allow the workflow to proceed past non-critical step failures'
  - 'Conditional branching: separate success and failure notification steps based on prior step state'
  - 'Workflow-level `read` and `list` permissions, so admins and the CI bot can follow the runs the webhook starts'
  - 'The `workflow()` function builder as a lighter alternative to the class pattern'
---

# Webhook-Triggered Workflow with Error Resilience

A CI/CD workflow that an `@HttpRoute` starts from a signed webhook, featuring `continueOnError`, per-step conditions, and the `workflow()` function builder.

## Code

```typescript
// src/workflows/github-deploy.workflow.ts
import { Workflow } from '@frontmcp/sdk';

@Workflow({
  name: 'github-deploy',
  description: 'Deploy on GitHub push events',
  timeout: 900000, // 15 minutes
  maxConcurrency: 3,
  // No execute rule: the webhook route calls execute_workflow as an anonymous caller
  permissions: [
    { action: 'read', roles: ['admin', 'ci-bot'] },
    { action: 'list', roles: ['admin', 'ci-bot'] },
  ],
  steps: [
    {
      id: 'build',
      jobName: 'build-project',
      input: { branch: 'main' },
    },
    {
      id: 'lint',
      jobName: 'run-linter',
      dependsOn: ['build'],
      continueOnError: true, // lint failures are non-blocking
      input: (steps) => ({
        workDir: steps.get('build').outputs.workDir,
      }),
    },
    {
      id: 'test',
      jobName: 'run-unit-tests',
      dependsOn: ['build'],
      continueOnError: true, // notify-failure checks its state
      input: (steps) => ({
        workDir: steps.get('build').outputs.workDir,
        coverage: true,
      }),
    },
    {
      id: 'deploy',
      jobName: 'deploy-artifact',
      dependsOn: ['lint', 'test'],
      condition: (steps) => steps.get('test').state === 'completed' && steps.get('test').outputs.passed === true,
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
        message: `Deployed to ${steps.get('deploy').outputs.url}`,
      }),
    },
    {
      id: 'notify-failure',
      jobName: 'notify-team',
      dependsOn: ['test'],
      condition: (steps) => steps.get('test').state === 'failed',
      input: {
        channel: '#alerts',
        message: 'CI pipeline failed -- check test results',
      },
    },
  ],
})
class GithubDeploy {}
```

```typescript
// src/routes/github-deploy.route.ts
import { httpRespond, HttpRoute, HttpRouteContext } from '@frontmcp/sdk';
import { bytesToHex, hmacSha256, timingSafeEqual } from '@frontmcp/utils';

const encoder = new TextEncoder();

// GitHub signs the body with the webhook secret: X-Hub-Signature-256: sha256=<hex HMAC>
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

List `GithubDeployWebhook` in the app's `routes` and `GithubDeploy` in its `workflows`. `@Workflow({ trigger: 'webhook', webhook })` registers no route: startup warns about it.

```typescript
// src/workflows/quick-deploy.workflow.ts
import { workflow } from '@frontmcp/sdk';

// Function-style workflow for simpler cases
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

## What This Demonstrates

- An `@HttpRoute` that checks an HMAC signature over the body as received and starts the workflow with `execute_workflow`
- Using `continueOnError: true` to allow the workflow to proceed past non-critical step failures
- Conditional branching: separate success and failure notification steps based on prior step state
- Workflow-level `read` and `list` permissions, so admins and the CI bot can follow the runs the webhook starts
- The `workflow()` function builder as a lighter alternative to the class pattern

## Related

- See `create-workflow` for starting a workflow, error handling, and registration, and `create-http-route` for routes
