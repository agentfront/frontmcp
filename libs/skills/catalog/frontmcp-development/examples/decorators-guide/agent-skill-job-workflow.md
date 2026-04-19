---
name: agent-skill-job-workflow
reference: decorators-guide
level: advanced
description: 'Demonstrates the advanced decorator types: `@Agent` for autonomous AI agents, `@Skill` for knowledge packages, `@Job` for background tasks, and `@Workflow` for multi-step orchestration.'
tags: [development, decorators, agent, skill, job, workflow]
features:
  - '`@Agent` with LLM config, input schema, and delegated tools for autonomous task execution'
  - '`@Skill` with inline instructions and tool references for reusable knowledge packages'
  - '`@Job` with retry policy, timeout, and typed input/output for background processing'
  - '`@Workflow` with ordered steps, `dependsOn` for sequencing, and `condition` for conditional execution'
  - 'Enabling jobs and skills at the server level via `jobs: { enabled: true }` and `skillsConfig: { enabled: true }`'
  - 'All advanced decorators registered in a single `@App` module'
---

# Agents, Skills, Jobs, and Workflows

Demonstrates the advanced decorator types: `@Agent` for autonomous AI agents, `@Skill` for knowledge packages, `@Job` for background tasks, and `@Workflow` for multi-step orchestration.

## Code

```typescript
// src/agents/research.agent.ts
import { Agent, AgentContext, z } from '@frontmcp/sdk';

@Agent({
  name: 'research_agent',
  description: 'Researches topics and produces summaries',
  llm: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
  inputSchema: {
    topic: z.string().describe('Topic to research'),
  },
  tools: [WebSearchTool, SummarizeTool],
})
class ResearchAgent extends AgentContext {
  async execute(input: { topic: string }) {
    return this.run(`Research and summarize: ${input.topic}`);
  }
}
```

```typescript
// src/skills/code-migration.skill.ts
import { Skill } from '@frontmcp/sdk';

@Skill({
  name: 'code_migration',
  description: 'Guides migration of code between frameworks',
  instructions: `
    1. Analyze the source codebase structure
    2. Identify framework-specific patterns
    3. Generate migration plan
    4. Apply transformations using the provided tools
  `,
  tools: [AnalyzeTool, TransformTool, ValidateTool],
  visibility: 'both',
})
class CodeMigrationSkill {}
```

```typescript
// src/jobs/sync-data.job.ts
import { Job, JobContext, z } from '@frontmcp/sdk';

@Job({
  name: 'sync_data',
  description: 'Synchronize data from external sources',
  inputSchema: z.object({ source: z.string().describe('Data source to sync') }),
  outputSchema: z.object({ synced: z.number() }),
  retry: { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2, maxBackoffMs: 60_000 },
  timeout: 300_000,
})
class SyncDataJob extends JobContext {
  async execute(input: { source: string }) {
    const count = await this.get(SyncService).runFullSync(input.source);
    return { synced: count };
  }
}
```

```typescript
// src/workflows/deploy-pipeline.workflow.ts
import { Workflow } from '@frontmcp/sdk';

@Workflow({
  name: 'deploy_pipeline',
  description: 'Full deployment pipeline',
  trigger: 'webhook',
  webhookConfig: {
    path: '/hooks/deploy',
    secret: process.env.WEBHOOK_SECRET!,
    methods: ['POST'],
  },
  timeout: 600_000,
  steps: [
    { id: 'build', jobName: 'build_app', input: { env: 'production' } },
    { id: 'test', jobName: 'run_tests', dependsOn: ['build'] },
    {
      id: 'deploy',
      jobName: 'deploy_app',
      dependsOn: ['test'],
      condition: (steps) => steps.test.success,
    },
  ],
})
class DeployPipeline {}
```

```typescript
// src/server.ts
import { App, FrontMcp } from '@frontmcp/sdk';

@App({
  name: 'platform',
  agents: [ResearchAgent],
  skills: [CodeMigrationSkill],
  jobs: [SyncDataJob],
  workflows: [DeployPipeline],
})
class PlatformApp {}

@FrontMcp({
  info: { name: 'advanced-server', version: '1.0.0' },
  apps: [PlatformApp],
  jobs: { enabled: true },
  skillsConfig: { enabled: true },
})
class MyServer {}
```

## What This Demonstrates

- `@Agent` with LLM config, input schema, and delegated tools for autonomous task execution
- `@Skill` with inline instructions and tool references for reusable knowledge packages
- `@Job` with retry policy, timeout, and typed input/output for background processing
- `@Workflow` with ordered steps, `dependsOn` for sequencing, and `condition` for conditional execution
- Enabling jobs and skills at the server level via `jobs: { enabled: true }` and `skillsConfig: { enabled: true }`
- All advanced decorators registered in a single `@App` module

## Related

- See `decorators-guide` for the complete decorator hierarchy and all field definitions
- See `create-plugin-hooks` for attaching lifecycle hooks to any flow
