---
name: basic-deploy-pipeline
reference: create-workflow
level: basic
description: 'A linear workflow that builds, tests, and deploys a service with step dependencies and dynamic input.'
tags: [development, workflow, pipeline]
features:
  - 'Defining a workflow with `@Workflow` decorator and sequential `steps`'
  - 'Using `dependsOn` to establish step execution order'
  - 'Passing dynamic input from a previous step using the callback form `(steps) => ({...})`'
  - 'Registering both jobs and workflows in `@App` with jobs enabled'
---

# Basic Deploy Pipeline Workflow

A linear workflow that builds, tests, and deploys a service with step dependencies and dynamic input.

## Code

```typescript
// src/workflows/deploy-pipeline.workflow.ts
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

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';

@App({
  name: 'pipeline-app',
  jobs: [BuildProjectJob, RunTestsJob, DeployToEnvJob],
  workflows: [DeployPipeline],
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

## What This Demonstrates

- Defining a workflow with `@Workflow` decorator and sequential `steps`
- Using `dependsOn` to establish step execution order
- Passing dynamic input from a previous step using the callback form `(steps) => ({...})`
- Registering both jobs and workflows in `@App` with jobs enabled

## Related

- See `create-workflow` for the full API reference including triggers, conditions, and error handling
