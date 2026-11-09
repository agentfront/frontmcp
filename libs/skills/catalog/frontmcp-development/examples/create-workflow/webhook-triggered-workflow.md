---
name: webhook-triggered-workflow
reference: create-workflow
level: advanced
description: 'A CI/CD workflow triggered by a signed webhook, featuring `continueOnError`, per-step conditions, and the `workflow()` function builder.'
tags: [development, workflow, webhook, triggered]
features:
  - "Webhook trigger with `trigger: 'webhook'` and `webhook: { path, secret, methods }`, and a CI step that signs its request"
  - "An `execute` rule that allows the webhook's role, `webhook:<workflow>`, beside the people who may run it"
  - 'Using `continueOnError: true` to allow the workflow to proceed past non-critical step failures'
  - 'Conditional branching: separate success and failure notification steps based on prior step state'
  - 'An `@HttpRoute` for a sender that signs its own way, such as a GitHub webhook'
  - 'The `workflow()` function builder as a lighter alternative to the class pattern'
---

# Webhook-Triggered Workflow with Error Resilience

A CI/CD workflow triggered by a signed webhook, featuring `continueOnError`, per-step conditions, and the `workflow()` function builder.

## Code

```typescript
// src/workflows/ci-deploy.workflow.ts
import { Workflow, z } from '@frontmcp/sdk';

@Workflow({
  name: 'ci-deploy',
  description: 'Deploy when the CI pipeline posts a signed build event',
  trigger: 'webhook',
  webhook: {
    path: '/webhooks/ci-deploy',
    secret: process.env.CI_DEPLOY_WEBHOOK_SECRET, // at least 32 characters; the server refuses to start without it
    methods: ['POST'],
  },
  inputSchema: {
    branch: z.string(),
    commitSha: z.string(),
  },
  timeout: 900000, // 15 minutes
  maxConcurrency: 3,
  permissions: [
    // The webhook's runs run as the role webhook:ci-deploy; admins may start runs with execute_workflow too
    { action: 'execute', roles: ['admin', 'webhook:ci-deploy'] },
    { action: 'read', roles: ['admin', 'ci-bot'] },
    { action: 'list', roles: ['admin', 'ci-bot'] },
  ],
  steps: [
    {
      id: 'build',
      jobName: 'build-project',
      input: (steps, input) => ({ branch: input.branch, commitSha: input.commitSha }),
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
      condition: (steps, input) =>
        input.branch === 'main' && steps.get('test').state === 'completed' && steps.get('test').outputs.passed === true,
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
class CiDeploy {}
```

The CI pipeline's last step signs the body with the same secret and posts it. The signature is `v1=` and the hex HMAC-SHA256 of `<timestamp>.<body>`, with the timestamp in Unix seconds:

```bash
body="{\"branch\":\"$BRANCH\",\"commitSha\":\"$COMMIT_SHA\"}"
timestamp=$(date +%s)
signature=$(printf '%s.%s' "$timestamp" "$body" | openssl dgst -sha256 -hmac "$CI_DEPLOY_WEBHOOK_SECRET" -r | cut -d' ' -f1)
curl -X POST https://mcp.example.com/webhooks/ci-deploy \
  -H 'Content-Type: application/json' \
  -H "X-FrontMCP-Timestamp: $timestamp" \
  -H "X-FrontMCP-Signature: v1=$signature" \
  --data-binary "$body"
# 202 {"runId":"...","state":"pending"}
```

A sender that signs its own way, such as a GitHub webhook (`X-Hub-Signature-256` over the body alone), can't call the trigger. Serve it an `@HttpRoute` that checks its signature and calls `execute_workflow`, here for `github-push-deploy`, the same steps without `trigger` or `webhook`:

```typescript
// src/routes/github-push.route.ts
import { httpRespond, HttpRoute, HttpRouteContext } from '@frontmcp/sdk';
import { bytesToHex, hmacSha256, timingSafeEqual } from '@frontmcp/utils';

const encoder = new TextEncoder();

// GitHub signs the body with the webhook secret: X-Hub-Signature-256: sha256=<hex HMAC>
@HttpRoute({ method: 'POST', path: '/webhooks/github-push', auth: 'public' })
export class GithubPushWebhook extends HttpRouteContext {
  async handle() {
    const secret = encoder.encode(process.env.GITHUB_WEBHOOK_SECRET ?? '');
    const body = this.request.bodyBytes ?? new Uint8Array();
    const expected = encoder.encode(`sha256=${bytesToHex(hmacSha256(secret, body))}`);
    const signature = encoder.encode(this.request.headers['x-hub-signature-256'] ?? '');
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      return httpRespond.unauthorized({ body: { error: 'Bad signature' } });
    }
    const push = this.request.body as { ref: string; after: string };
    const run = await this.callTool('execute_workflow', {
      name: 'github-push-deploy',
      input: { branch: push.ref.replace('refs/heads/', ''), commitSha: push.after },
      background: true,
    });
    return run.structuredContent; // { runId, state: 'pending' }
  }
}
```

The route calls `execute_workflow` as an anonymous caller, so `github-push-deploy` must have no `execute` rule an anonymous caller fails: the route's signature check is what protects it. List `GithubPushWebhook` in the app's `routes`.

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

- Webhook trigger with `trigger: 'webhook'` and `webhook: { path, secret, methods }`, and a CI step that signs its request
- An `execute` rule that allows the webhook's role, `webhook:<workflow>`, beside the people who may run it
- Using `continueOnError: true` to allow the workflow to proceed past non-critical step failures
- Conditional branching: separate success and failure notification steps based on prior step state
- An `@HttpRoute` for a sender that signs its own way, such as a GitHub webhook
- The `workflow()` function builder as a lighter alternative to the class pattern

## Related

- See `create-workflow` for the trigger types (manual, webhook), the signature scheme, error handling, and registration, and `create-http-route` for routes
