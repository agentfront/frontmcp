---
name: parallel-validation-pipeline
reference: create-workflow
level: intermediate
description: 'A workflow that validates multiple datasets in parallel, then conditionally merges results or notifies on failure.'
tags: [development, workflow, parallel, validation, pipeline]
features:
  - 'Running steps in parallel by omitting `dependsOn` (no mutual dependencies)'
  - 'Using `maxConcurrency` to limit how many steps run at the same time'
  - 'Conditional steps with `condition` that check `.state` of previous steps'
  - 'Fan-out/fan-in pattern: parallel validation steps converge into a merge step'
  - 'Branching: separate success and failure notification paths'
---

# Parallel Validation Pipeline with Conditional Steps

A workflow that validates multiple datasets in parallel, then conditionally merges results or notifies on failure.

## Code

```typescript
// src/workflows/data-validation.workflow.ts
import { Workflow } from '@frontmcp/sdk';

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
      condition: (steps) =>
        steps.get('validate-users').state === 'completed' &&
        steps.get('validate-orders').state === 'completed' &&
        steps.get('validate-products').state === 'completed',
      input: (steps) => ({
        userReport: steps.get('validate-users').outputs,
        orderReport: steps.get('validate-orders').outputs,
        productReport: steps.get('validate-products').outputs,
      }),
    },
    // Notify on any failure
    {
      id: 'notify-failure',
      jobName: 'send-notification',
      dependsOn: ['validate-users', 'validate-orders', 'validate-products'],
      condition: (steps) =>
        steps.get('validate-users').state === 'failed' ||
        steps.get('validate-orders').state === 'failed' ||
        steps.get('validate-products').state === 'failed',
      input: {
        channel: '#alerts',
        message: 'Data validation pipeline encountered failures',
      },
    },
  ],
})
class DataValidationPipeline {}
```

## What This Demonstrates

- Running steps in parallel by omitting `dependsOn` (no mutual dependencies)
- Using `maxConcurrency` to limit how many steps run at the same time
- Conditional steps with `condition` that check `.state` of previous steps
- Fan-out/fan-in pattern: parallel validation steps converge into a merge step
- Branching: separate success and failure notification paths

## Related

- See `create-workflow` for the full DAG execution model, diamond dependencies, and `continueOnError`
