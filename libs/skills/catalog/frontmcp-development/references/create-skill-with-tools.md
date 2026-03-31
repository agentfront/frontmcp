---
name: create-skill-with-tools
description: Create skills that combine structured instructions with MCP tool references for orchestration
---

# Creating a Skill with Tools

Skills are knowledge and workflow guides that help LLMs accomplish multi-step tasks using available MCP tools. Unlike tools (which execute actions directly) or agents (which run autonomous LLM loops), skills provide structured instructions, tool references, and context that the AI client uses to orchestrate tool calls on its own.

## When to Use This Skill

### Must Use

- Teaching an AI client how to accomplish a complex task by combining multiple tools in a defined sequence
- Building directory-based skills with `SKILL.md`, scripts, references, and assets loaded via `skillDir()`
- Defining tool-orchestration instructions with explicit tool references, parameters, and examples

### Recommended

- Creating reusable workflow guides that can be discovered via HTTP (`/llm.txt`, `/skills`) or MCP protocol
- Wrapping existing tools into a higher-level procedure with step-by-step instructions and validation modes
- Providing AI clients with structured playbooks for incident response, deployment, or data-processing flows

### Skip When

- You need a single executable action with direct input/output (see `create-tool`)
- You need an autonomous LLM loop that reasons across multiple steps on its own (see `create-agent`)
- You are building a conversational template or system prompt without tool references (see `create-prompt`)

> **Decision:** Use this skill when you need to guide an AI client through a multi-tool workflow using structured instructions and tool references, without executing anything directly.

| Aspect     | @Skill                   | @Tool                | @Agent               |
| ---------- | ------------------------ | -------------------- | -------------------- |
| Execution  | None (instructions only) | Direct function call | Autonomous LLM loop  |
| Purpose    | Workflow guide for AI    | Single action        | Multi-step reasoning |
| Tool usage | References tools by name | Is a tool            | Has inner tools      |
| Output     | Instructions + tool refs | Computed result      | LLM-generated result |

## Class-Based Pattern

Create a class extending `SkillContext` and implement the `build(): Promise<SkillContent>` method. The `@Skill` decorator requires at minimum a `name` and `description`.

```typescript
import { Skill, SkillContext } from '@frontmcp/sdk';

@Skill({
  name: 'deploy-service',
  description: 'Deploy a service through the build, test, and release pipeline',
  instructions: `# Deploy Service Workflow

## Step 1: Build
Use the \`build_project\` tool to compile the service.
Pass the service name and target environment.

## Step 2: Run Tests
Use the \`run_tests\` tool to execute the test suite.
If tests fail, stop and report the failures.

## Step 3: Deploy
Use the \`deploy_to_env\` tool to push the build to the target environment.
Verify the deployment using \`health_check\` tool.

## Step 4: Notify
Use the \`send_notification\` tool to notify the team of the deployment status.`,
  tools: [BuildProjectTool, RunTestsTool, DeployToEnvTool, HealthCheckTool, SendNotificationTool],
})
class DeployServiceSkill extends SkillContext {}
```

### Available Context Methods

`SkillContext` provides:

- `loadInstructions(): Promise<string>` -- load and return the skill's instructions content
- `build(): Promise<SkillContent>` -- build the full skill content (instructions + tool refs + metadata)
- `getToolRefs(): SkillToolRef[]` -- get the list of tool references
- `getToolNames(): string[]` -- get the list of tool names

## Tool References: Three Ways to Specify Tools

The `tools` array in `@Skill` metadata supports three ways to reference tools that the skill uses in its instructions.

### 1. Class Reference

Pass the tool class directly. The framework resolves the tool name and validates it exists in the registry.

```typescript
@Skill({
  name: 'data-pipeline',
  description: 'Run a data processing pipeline',
  instructions: 'Use extract_data, transform_data, and load_data in sequence.',
  tools: [ExtractDataTool, TransformDataTool, LoadDataTool],
})
class DataPipelineSkill extends SkillContext {}
```

### 2. String Name

Reference a tool by its registered name. Useful for tools registered elsewhere or external tools.

```typescript
@Skill({
  name: 'code-review',
  description: 'Review code changes',
  instructions: 'Use git_diff to get changes, then use analyze_code to review them.',
  tools: ['git_diff', 'analyze_code', 'post_comment'],
})
class CodeReviewSkill extends SkillContext {}
```

### 3. Object with Metadata

Provide a detailed reference with name, purpose description, and required flag.

```typescript
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
})
class IncidentResponseSkill extends SkillContext {}
```

You can mix all three styles in a single `tools` array:

```typescript
tools: [
  BuildProjectTool,                // class reference
  'run_tests',                     // string name
  { name: 'deploy', purpose: 'Deploy to environment', required: true },  // object
],
```

## Tool Validation Modes

The `toolValidation` field controls what happens when referenced tools are not found in the registry at startup.

```typescript
@Skill({
  name: 'strict-workflow',
  description: 'Workflow that requires all tools to exist',
  instructions: '...',
  tools: [RequiredToolA, RequiredToolB],
  toolValidation: 'strict', // fail if any tool is missing
})
class StrictWorkflowSkill extends SkillContext {}
```

| Mode       | Behavior                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `'strict'` | Throws an error if any referenced tool is not registered. Use for production workflows where missing tools would cause failures. |
| `'warn'`   | Logs a warning for missing tools but continues. Use during development when tools may not all be available yet.                  |
| `'ignore'` | Silently ignores missing tools. Use for optional tool references or cross-server skills.                                         |

## Instruction Sources

Skills support three ways to provide instructions.

### Inline String

```typescript
@Skill({
  name: 'quick-task',
  description: 'A simple task',
  instructions: 'Step 1: Use tool_a. Step 2: Use tool_b.',
})
class QuickTaskSkill extends SkillContext {}
```

### File Reference

Load instructions from a Markdown file relative to the skill file:

```typescript
@Skill({
  name: 'complex-workflow',
  description: 'A complex multi-step workflow',
  instructions: { file: './skills/complex-workflow.md' },
  tools: [ToolA, ToolB, ToolC],
})
class ComplexWorkflowSkill extends SkillContext {}
```

### URL Reference

Load instructions from a remote URL:

```typescript
@Skill({
  name: 'remote-workflow',
  description: 'Workflow with remote instructions',
  instructions: { url: 'https://docs.example.com/workflows/deploy.md' },
  tools: ['build', 'test', 'deploy'],
})
class RemoteWorkflowSkill extends SkillContext {}
```

## Directory-Based Skills with skillDir()

Use `skillDir()` to load a skill from a directory structure. The directory is expected to contain a `SKILL.md` file with frontmatter and instructions, plus optional subdirectories for scripts, references, and assets.

```text
skills/
  deploy-service/
    SKILL.md           # Instructions with YAML frontmatter
    scripts/
      validate.sh      # Helper scripts
      smoke-test.sh
    references/
      architecture.md  # Reference documentation
      runbook.md
    assets/
      topology.png     # Visual assets
```

```typescript
import { skillDir } from '@frontmcp/sdk';

const DeployServiceSkill = await skillDir('./skills/deploy-service');
```

The `SKILL.md` file uses YAML frontmatter for metadata, followed by the instructions body:

```markdown
---
name: deploy-service
description: Deploy a service through the full pipeline
tags: [deploy, ci-cd, production]
tools:
  - name: build_project
    purpose: Compile the service
    required: true
  - name: run_tests
    purpose: Execute test suite
    required: true
  - name: deploy_to_env
    purpose: Push build to target environment
    required: true
parameters:
  - name: environment
    description: Target deployment environment
    type: string
    required: true
examples:
  - scenario: Deploy to staging
    expected-outcome: Service deployed and health check passes
---

# Deploy Service

Follow these steps to deploy the service...
```

## Skill Parameters

Parameters let callers customize skill behavior. They appear in the skill's metadata and can be used in instructions.

```typescript
@Skill({
  name: 'setup-project',
  description: 'Set up a new project from a template',
  instructions: 'Use create_project tool with the specified template and language.',
  tools: ['create_project', 'install_dependencies', 'init_git'],
  parameters: [
    { name: 'template', description: 'Project template to use', type: 'string', required: true },
    { name: 'language', description: 'Programming language', type: 'string', default: 'typescript' },
    { name: 'include-ci', description: 'Include CI configuration', type: 'boolean', default: true },
  ],
})
class SetupProjectSkill extends SkillContext {}
```

## Skill Examples

Examples show the AI how the skill should be used and what outcomes to expect:

```typescript
@Skill({
  name: 'database-migration',
  description: 'Run database migrations safely',
  instructions: '...',
  tools: ['generate_migration', 'run_migration', 'rollback_migration', 'backup_database'],
  examples: [
    {
      scenario: 'Add a new column to the users table',
      expectedOutcome: 'Migration generated, backup created, migration applied, verified',
    },
    {
      scenario: 'Rollback a failed migration',
      expectedOutcome: 'Failed migration identified, rolled back, database restored to previous state',
    },
  ],
})
class DatabaseMigrationSkill extends SkillContext {}
```

## Skill Visibility

Control where the skill is discoverable using the `visibility` field:

```typescript
@Skill({
  name: 'internal-deploy',
  description: 'Internal deployment workflow',
  instructions: '...',
  visibility: 'mcp', // Only visible via MCP protocol
})
class InternalDeploySkill extends SkillContext {}
```

| Value    | Description                                             |
| -------- | ------------------------------------------------------- |
| `'mcp'`  | Visible only via MCP protocol (tool listing)            |
| `'http'` | Visible only via HTTP endpoints (`/llm.txt`, `/skills`) |
| `'both'` | Visible via both MCP and HTTP (default)                 |

## Hiding Skills from Discovery

Use `hideFromDiscovery: true` to register a skill that is not listed in discovery endpoints but can still be invoked directly:

```typescript
@Skill({
  name: 'admin-maintenance',
  description: 'Internal maintenance procedures',
  instructions: '...',
  hideFromDiscovery: true,
})
class AdminMaintenanceSkill extends SkillContext {}
```

## Agent Skills Spec Fields

Skills support additional metadata fields from the Anthropic Agent Skills specification:

```typescript
@Skill({
  name: 'deploy-to-prod',
  description: 'Production deployment workflow',
  instructions: { file: './deploy-prod.md' },
  tools: [BuildTool, DeployTool, HealthCheckTool],
  priority: 10, // Higher = earlier in search results
  license: 'MIT', // License identifier
  compatibility: 'Node.js 24+, Docker', // Environment requirements (max 500 chars)
  allowedTools: 'Read Edit Bash(git status)', // Pre-approved tools (space-delimited)
  specMetadata: {
    // Arbitrary key-value metadata
    author: 'platform-team',
    version: '2.0.0',
  },
  resources: {
    // Bundled resource directories
    scripts: './scripts', // Helper scripts
    references: './references', // Reference documents
    assets: './assets', // Static assets
  },
})
class DeployToProdSkill extends SkillContext {}
```

| Field           | Description                                                      |
| --------------- | ---------------------------------------------------------------- |
| `priority`      | Search ranking weight; higher = earlier (default: `0`)           |
| `license`       | License identifier (e.g., `'MIT'`, `'Apache-2.0'`)               |
| `compatibility` | Environment requirements (max 500 chars)                         |
| `allowedTools`  | Space-delimited pre-approved tool names for the skill            |
| `specMetadata`  | Arbitrary `Record<string, string>` map (Agent Skills `metadata`) |
| `resources`     | Bundled dirs: `{ scripts?, references?, assets? }` paths         |

## Function-Style Builder

For skills that do not need a class, use the `skill()` function builder:

```typescript
import { skill } from '@frontmcp/sdk';

const QuickDeploySkill = skill({
  name: 'quick-deploy',
  description: 'Quick deployment to staging',
  instructions: `# Quick Deploy
1. Use build_project to compile.
2. Use deploy_to_env with environment=staging.
3. Use health_check to verify.`,
  tools: ['build_project', 'deploy_to_env', 'health_check'],
});
```

Register it the same way as a class skill: `skills: [QuickDeploySkill]`.

## Remote and ESM Loading

Load skills from external modules or remote URLs without importing them directly.

**ESM loading** -- load a skill from an ES module:

```typescript
const ExternalSkill = Skill.esm('@my-org/skills@^1.0.0', 'ExternalSkill', {
  description: 'A skill loaded from an ES module',
});
```

**Remote loading** -- load a skill from a remote URL:

```typescript
const CloudSkill = Skill.remote('https://example.com/skills/cloud-skill', 'CloudSkill', {
  description: 'A skill loaded from a remote server',
});
```

Both return values that can be registered in `skills: [ExternalSkill, CloudSkill]`.

## Registration

Add skill classes (or function-style skills) to the `skills` array in `@FrontMcp` or `@App`.

```typescript
import { FrontMcp, App } from '@frontmcp/sdk';

@App({
  name: 'devops-app',
  skills: [DeployServiceSkill, IncidentResponseSkill],
  tools: [BuildProjectTool, RunTestsTool, DeployToEnvTool],
})
class DevOpsApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [DevOpsApp],
  skills: [QuickDeploySkill], // can also register skills directly on the server
})
class MyServer {}
```

## Nx Generators

Scaffold a new skill using the Nx generators:

```bash
# Create a skill class file
nx generate @frontmcp/nx:skill

# Create a directory-based skill with SKILL.md, scripts/, references/, assets/
nx generate @frontmcp/nx:skill-dir
```

The class generator creates the skill file, spec file, and updates barrel exports. The directory generator creates the full directory structure ready for `skillDir()`.

## HTTP Endpoints for Skill Discovery

When skills have `visibility` set to `'http'` or `'both'`, they are discoverable via HTTP endpoints:

### /llm.txt

Returns a plain-text document listing all HTTP-visible skills with their descriptions and instructions. This endpoint follows the `llm.txt` convention for AI-readable site documentation.

```
GET /llm.txt

# Skills

## deploy-service
Deploy a service through the build, test, and release pipeline
Tools: build_project, run_tests, deploy_to_env, health_check, send_notification
...
```

### /skills

Returns a JSON array of all HTTP-visible skills with full metadata:

```
GET /skills

[
  {
    "name": "deploy-service",
    "description": "Deploy a service through the build, test, and release pipeline",
    "instructions": "...",
    "tools": ["build_project", "run_tests", "deploy_to_env"],
    "parameters": [...],
    "examples": [...],
    "tags": ["deploy", "ci-cd"],
    "visibility": "both"
  }
]
```

## Complete Example: Multi-Tool Orchestration Skill

```typescript
import { Skill, SkillContext, Tool, ToolContext, FrontMcp, App } from '@frontmcp/sdk';
import { z } from 'zod';

// Define the tools that the skill references

@Tool({
  name: 'analyze_codebase',
  description: 'Analyze a codebase for patterns and issues',
  inputSchema: {
    path: z.string().describe('Path to the codebase'),
    checks: z.array(z.string()).describe('Checks to run'),
  },
})
class AnalyzeCodebaseTool extends ToolContext {
  async execute(input: { path: string; checks: string[] }) {
    return { issues: [], score: 95 };
  }
}

@Tool({
  name: 'generate_report',
  description: 'Generate a Markdown report from analysis results',
  inputSchema: {
    title: z.string(),
    sections: z.array(z.object({ heading: z.string(), content: z.string() })),
  },
})
class GenerateReportTool extends ToolContext {
  async execute(input: { title: string; sections: { heading: string; content: string }[] }) {
    return `# ${input.title}\n${input.sections.map((s) => `## ${s.heading}\n${s.content}`).join('\n')}`;
  }
}

@Tool({
  name: 'create_issue',
  description: 'Create a GitHub issue for a found problem',
  inputSchema: {
    title: z.string(),
    body: z.string(),
    labels: z.array(z.string()).optional(),
  },
})
class CreateIssueTool extends ToolContext {
  async execute(input: { title: string; body: string; labels?: string[] }) {
    return { issueNumber: 42, url: 'https://github.com/org/repo/issues/42' };
  }
}

// Define the skill that orchestrates these tools

@Skill({
  name: 'codebase-audit',
  description: 'Perform a comprehensive codebase audit with reporting and issue creation',
  instructions: `# Codebase Audit Workflow

## Step 1: Analyze
Use the \`analyze_codebase\` tool to scan the codebase.
Run these checks: ["security", "performance", "maintainability", "testing"].

## Step 2: Review Results
Examine the analysis output. Group issues by severity (critical, warning, info).

## Step 3: Generate Report
Use \`generate_report\` to create a Markdown report with sections for each check category.
Include the overall score and a summary of findings.

## Step 4: Create Issues
For each critical issue found, use \`create_issue\` to file a GitHub issue.
Label critical issues with "priority:high" and "audit".
Label warnings with "priority:medium" and "audit".

## Step 5: Summary
Provide a final summary with:
- Total issues found by severity
- Overall codebase score
- Links to created GitHub issues`,
  tools: [
    AnalyzeCodebaseTool,
    GenerateReportTool,
    { name: 'create_issue', purpose: 'File GitHub issues for critical findings', required: false },
  ],
  toolValidation: 'strict',
  parameters: [
    { name: 'path', description: 'Path to the codebase to audit', type: 'string', required: true },
    { name: 'create-issues', description: 'Whether to create GitHub issues', type: 'boolean', default: true },
  ],
  examples: [
    {
      scenario: 'Audit a Node.js API project',
      expectedOutcome: 'Analysis complete, report generated, critical issues filed on GitHub',
    },
  ],
  tags: ['audit', 'code-quality', 'github'],
  visibility: 'both',
})
class CodebaseAuditSkill extends SkillContext {}

// Register everything

@App({
  name: 'audit-app',
  skills: [CodebaseAuditSkill],
  tools: [AnalyzeCodebaseTool, GenerateReportTool, CreateIssueTool],
})
class AuditApp {}

@FrontMcp({
  info: { name: 'audit-server', version: '1.0.0' },
  apps: [AuditApp],
})
class AuditServer {}
```

## CodeCall Compatibility

When the `CodeCallPlugin` is active in `codecall_only` mode, all tools registered on the server are hidden from `list_tools`. The AI client only sees the three CodeCall meta-tools (`codecall:search`, `codecall:describe`, `codecall:execute`). This means skill instructions that reference tool names directly (e.g., "Use the `build_project` tool") become misleading -- the AI cannot call those tools because they do not appear in the tool listing.

### When This Matters

This is only relevant when the server initializes CodeCall in `codecall_only` mode:

```typescript
CodeCallPlugin.init({ mode: 'codecall_only' });
```

With `codecall_opt_in` or `metadata_driven` modes, tools remain visible in `list_tools` alongside the CodeCall meta-tools. In those modes, standard tool-referencing instructions continue to work without changes.

### Writing Dual-Mode Instructions

Write skill instructions that work regardless of whether CodeCall is active. Instead of referencing tool names as direct calls, instruct the AI to use the search-describe-execute pattern:

```markdown
## Step 1: Find Available Tools

Search for tools related to your task using codecall:search.
Query: ["build project", "run tests", "deploy"]

## Step 2: Describe Tool Interfaces

Once you find matching tools, use codecall:describe to understand their input schemas.

## Step 3: Execute

Use codecall:execute with an AgentScript that calls the tools:
const build = await callTool('build_project', { target: 'production' });
const tests = await callTool('run_tests', { suite: 'e2e' });
```

### Supporting Both Direct and CodeCall Workflows

If you want the skill to work with and without CodeCall, list the tool names in the `tools` array (so they are associated with the skill in metadata) AND include instructions for both direct calls and the CodeCall workflow. This way:

- In standard mode, the AI sees the tools in `list_tools` and can call them directly using the tool names from the `tools` array.
- In `codecall_only` mode, the AI follows the search-describe-execute instructions to discover and invoke the same tools through CodeCall.

```typescript
@Skill({
  name: 'deploy-service',
  description: 'Deploy a service through the pipeline',
  instructions: `# Deploy Service

## Finding the Tools
If tools are not directly visible, search for them:
Use codecall:search with query ["build project", "run tests", "deploy to environment"].
Then use codecall:describe on each result to confirm the input schema.

## Step 1: Build
Call build_project with the service name and target environment.
If using CodeCall: codecall:execute with callTool('build_project', { ... }).

## Step 2: Test
Call run_tests with the test suite name.
If using CodeCall: codecall:execute with callTool('run_tests', { ... }).`,
  tools: [BuildProjectTool, RunTestsTool, DeployToEnvTool],
})
class DeployServiceSkill extends SkillContext {}
```

## Common Patterns

| Pattern                | Correct                                                                               | Incorrect                                                      | Why                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Tool references        | `tools: [BuildTool, 'run_tests', { name: 'deploy', purpose: '...', required: true }]` | `tools: [{ class: BuildTool }]` (object with `class` key)      | The `tools` array accepts class refs, strings, or `{ name, purpose, required }` objects only |
| Tool validation        | `toolValidation: 'strict'` for production skills                                      | Omitting `toolValidation` for critical workflows               | Default is `'warn'`; production skills should fail fast on missing tools with `'strict'`     |
| Instruction source     | `instructions: { file: './skills/deploy.md' }` for long content                       | Inlining hundreds of lines in the decorator string             | File-based instructions keep decorator metadata readable and instructions maintainable       |
| Skill visibility       | `visibility: 'both'` (default) for public skills                                      | Setting `visibility: 'mcp'` when HTTP discovery is also needed | Skills with `'mcp'` visibility are hidden from `/llm.txt` and `/skills` HTTP endpoints       |
| Parameter types        | `parameters: [{ name: 'env', type: 'string', required: true }]`                       | `parameters: { env: 'string' }` (plain object shape)           | Parameters must be an array of `{ name, description, type, required?, default? }` objects    |
| CodeCall compatibility | List tools AND include codecall:search/execute instructions                           | Only listing tools by name                                     | When CodeCall hides tools, AI can't find them without search instructions                    |

## Verification Checklist

### Configuration

- [ ] `@Skill` decorator has `name` and `description`
- [ ] `instructions` are provided via inline string, `{ file }`, or `{ url }`
- [ ] All tool references in `tools` array resolve to registered tools (when `toolValidation: 'strict'`)
- [ ] Skill is registered in `skills` array of `@App` or `@FrontMcp`

### Runtime

- [ ] Skill appears in MCP skill listing (`skills/list`) when `visibility` includes `'mcp'`
- [ ] Skill appears at `/llm.txt` and `/skills` HTTP endpoints when `visibility` includes `'http'`
- [ ] `build()` returns complete `SkillContent` with instructions and tool references
- [ ] `getToolRefs()` returns the correct list of resolved tool references
- [ ] Hidden skills (`hideFromDiscovery: true`) are invocable but not listed in discovery

### Directory-Based Skills

- [ ] `SKILL.md` file exists at the root of the skill directory with valid YAML frontmatter
- [ ] `skillDir()` correctly loads instructions, scripts, references, and assets
- [ ] Frontmatter `tools` entries match registered tool names

## Troubleshooting

| Problem                                      | Cause                                                       | Solution                                                                               |
| -------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Skill not appearing in `/llm.txt`            | `visibility` is set to `'mcp'`                              | Change to `'both'` or `'http'` to include HTTP discovery                               |
| `toolValidation: 'strict'` throws at startup | A referenced tool is not registered in the scope            | Register all referenced tools in the `tools` array of `@App` or `@FrontMcp`            |
| `skillDir()` fails to load                   | `SKILL.md` file missing or frontmatter is invalid YAML      | Ensure the directory contains a `SKILL.md` with valid `---` delimited YAML frontmatter |
| Instructions are empty at runtime            | `{ file: './path.md' }` path is relative to wrong directory | Use a path relative to the skill file's location, not the project root                 |
| Parameters not visible to AI client          | `parameters` defined as a plain object instead of an array  | Use array format: `[{ name, description, type, required }]`                            |

## Examples

| Example                                                                                           | Level        | Description                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| [`basic-tool-orchestration`](../examples/create-skill-with-tools/basic-tool-orchestration.md)     | Basic        | A skill that guides an AI client through a deploy workflow using referenced MCP tools.                               |
| [`directory-skill-with-tools`](../examples/create-skill-with-tools/directory-skill-with-tools.md) | Advanced     | A directory-based skill loaded with `skillDir()`, plus a class-based skill using Agent Skills spec metadata fields.  |
| [`incident-response-skill`](../examples/create-skill-with-tools/incident-response-skill.md)       | Intermediate | A skill that uses object-style tool references with purpose descriptions and required flags, plus strict validation. |

> See all examples in [`examples/create-skill-with-tools/`](../examples/create-skill-with-tools/)

## Reference

- [Skills Documentation](https://docs.agentfront.dev/frontmcp/servers/skills)
- Related skills: `create-skill`, `create-tool`, `create-agent`, `create-prompt`
