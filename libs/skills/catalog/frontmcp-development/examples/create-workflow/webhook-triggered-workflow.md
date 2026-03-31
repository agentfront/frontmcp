---
name: webhook-triggered-workflow
reference: create-workflow
level: advanced
description: 'A CI/CD workflow triggered by a webhook, featuring `continueOnError`, per-step conditions, and the `workflow()` function builder.'
tags: [development, workflow, webhook, triggered]
features:
  - "Webhook trigger with `trigger: 'webhook'` and `webhook: { path, secret, methods }`"
  - 'Using `continueOnError: true` to allow the workflow to proceed past non-critical step failures'
  - 'Conditional branching: separate success and failure notification steps based on prior step state'
  - 'Workflow-level `permissions` for access control'
  - 'The `workflow()` function builder as a lighter alternative to the class pattern'
---

# Webhook-Triggered Workflow with Error Resilience

A CI/CD workflow triggered by a webhook, featuring `continueOnError`, per-step conditions, and the `workflow()` function builder.

## Code

```typescript
// src/workflows/github-deploy.workflow.ts
import { Workflow } from '@frontmcp/sdk';

@Workflow({
  name: 'github-deploy',
  description: 'Deploy on GitHub push events',
  trigger: 'webhook',
  webhook: {
    path: '/webhooks/github-deploy',
    secret: process.env.WEBHOOK_SECRET,
    methods: ['POST'],
  },
  timeout: 900000, // 15 minutes
  maxConcurrency: 3,
  permissions: {
    actions: ['create', 'read', 'execute', 'list'],
    roles: ['admin', 'ci-bot'],
  },
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

- Webhook trigger with `trigger: 'webhook'` and `webhook: { path, secret, methods }`
- Using `continueOnError: true` to allow the workflow to proceed past non-critical step failures
- Conditional branching: separate success and failure notification steps based on prior step state
- Workflow-level `permissions` for access control
- The `workflow()` function builder as a lighter alternative to the class pattern

## Related

- See `create-workflow` for the full trigger types (manual, webhook, event), error handling, and registration
