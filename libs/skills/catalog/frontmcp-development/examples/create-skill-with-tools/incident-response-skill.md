---
name: incident-response-skill
reference: create-skill-with-tools
level: intermediate
description: 'A skill that uses object-style tool references with purpose descriptions and required flags, plus strict validation.'
tags: [development, skill, tools, incident, response]
features:
  - 'Object-style tool references with `name`, `purpose`, and `required` fields'
  - "Using `toolValidation: 'strict'` to fail at startup if any referenced tool is missing"
  - 'Combining tool references with `parameters` and `examples` for full skill metadata'
  - "Setting `visibility: 'mcp'` to restrict discovery to MCP protocol only"
  - 'Registering both skills and their referenced tools in the same `@App`'
---

# Incident Response Skill with Detailed Tool Metadata

A skill that uses object-style tool references with purpose descriptions and required flags, plus strict validation.

## Code

```typescript
// src/skills/incident-response.skill.ts
import { Skill, SkillContext } from '@frontmcp/sdk';

@Skill({
  name: 'incident-response',
  description: 'Respond to production incidents',
  instructions: `# Incident Response

## Step 1: Gather Information
Use check_service_health to determine which services are affected.
Use query_logs to find error patterns.

## Step 2: Mitigate
Use rollback_deployment if a recent deploy caused the issue.
Use scale_service if the issue is load-related.

## Step 3: Communicate
Use send_notification to update the incident channel.`,
  tools: [
    { name: 'check_service_health', purpose: 'Check health status of services', required: true },
    { name: 'query_logs', purpose: 'Search application logs for errors', required: true },
    { name: 'rollback_deployment', purpose: 'Rollback to previous deployment', required: false },
    { name: 'scale_service', purpose: 'Scale service replicas up or down', required: false },
    { name: 'send_notification', purpose: 'Send notification to Slack channel', required: true },
  ],
  toolValidation: 'strict', // Fail at startup if any required tool is missing
  parameters: [
    { name: 'severity', description: 'Incident severity level', type: 'string', required: true },
    { name: 'auto-rollback', description: 'Whether to auto-rollback on detection', type: 'boolean', default: false },
  ],
  examples: [
    {
      scenario: 'API latency spike after a deployment',
      expectedOutcome: 'Health checked, logs queried, deployment rolled back, team notified',
    },
  ],
  tags: ['incident', 'ops', 'on-call'],
  visibility: 'mcp',
})
class IncidentResponseSkill extends SkillContext {}
```

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';

@App({
  name: 'ops-app',
  skills: [IncidentResponseSkill],
  tools: [CheckServiceHealthTool, QueryLogsTool, RollbackDeploymentTool, ScaleServiceTool, SendNotificationTool],
})
class OpsApp {}

@FrontMcp({
  info: { name: 'ops-server', version: '1.0.0' },
  apps: [OpsApp],
})
class OpsServer {}
```

## What This Demonstrates

- Object-style tool references with `name`, `purpose`, and `required` fields
- Using `toolValidation: 'strict'` to fail at startup if any referenced tool is missing
- Combining tool references with `parameters` and `examples` for full skill metadata
- Setting `visibility: 'mcp'` to restrict discovery to MCP protocol only
- Registering both skills and their referenced tools in the same `@App`

## Related

- See `create-skill-with-tools` for all tool validation modes and the CodeCall compatibility section
