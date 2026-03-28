# Creating Instruction-Only Skills

Skills are knowledge and workflow packages that teach AI clients how to accomplish tasks. Unlike tools (which execute actions) or agents (which run autonomous LLM loops), a skill provides structured instructions that the AI follows on its own. An instruction-only skill contains no tool references -- it is purely a guide.

## When to Use This Skill

### Must Use

- You need to package knowledge, conventions, or workflow steps as a reusable skill that AI clients can follow
- You are creating a SKILL.md catalog entry or a class/function-based skill with no tool dependencies
- You want to enforce coding standards, onboarding steps, or review criteria through structured AI guidance

### Recommended

- You are building a deployment runbook, architecture decision record, or quality gate checklist
- You want to share workflow templates across teams via MCP or HTTP discovery endpoints
- You need parameterized instructions that callers can customize per invocation

### Skip When

- The skill must invoke MCP tools during execution -- use `create-skill-with-tools` instead
- You need an autonomous agent loop rather than static instructions -- use an agent pattern instead
- The content is a one-off prompt with no reuse value -- a plain prompt template is simpler

> **Decision:** Pick this skill when you need a reusable, instruction-only knowledge package that guides AI through a workflow without requiring tool calls.

## Class-Based Pattern

Create a class extending `SkillContext` and decorate it with `@Skill`. The decorator requires `name`, `description`, and `instructions`.

### SkillMetadata Fields

| Field               | Type                                            | Required | Description                                                 |
| ------------------- | ----------------------------------------------- | -------- | ----------------------------------------------------------- |
| `name`              | `string`                                        | Yes      | Unique skill name in kebab-case                             |
| `description`       | `string`                                        | Yes      | Short description of what the skill teaches                 |
| `instructions`      | `string \| { file: string } \| { url: string }` | Yes      | The skill content -- see instruction sources below          |
| `parameters`        | `SkillParameter[]`                              | No       | Customization parameters for the skill                      |
| `examples`          | `SkillExample[]`                                | No       | Usage scenarios and expected outcomes                       |
| `tags`              | `string[]`                                      | No       | Categorization tags for discovery                           |
| `visibility`        | `'mcp' \| 'http' \| 'both'`                     | No       | Where the skill is discoverable (default: `'both'`)         |
| `hideFromDiscovery` | `boolean`                                       | No       | Register but hide from listing endpoints (default: `false`) |

### Basic Example

```typescript
import { Skill, SkillContext } from '@frontmcp/sdk';

@Skill({
  name: 'typescript-conventions',
  description: 'TypeScript coding conventions and patterns for the project',
  instructions: `# TypeScript Conventions

## Naming
- Use PascalCase for classes and interfaces
- Use camelCase for variables, functions, and methods
- Use UPPER_SNAKE_CASE for constants
- Use kebab-case for file names

## Types
- Always use explicit return types on public methods
- Prefer \`unknown\` over \`any\` for generic defaults
- Use strict mode (\`strict: true\` in tsconfig)
- Define shared types in a common directory

## Error Handling
- Use specific error classes, not raw Error
- Never use non-null assertions (\`!\`) -- throw proper errors
- Use \`this.fail(err)\` in execution contexts

## Imports
- Use barrel exports (index.ts) for public APIs
- No circular dependencies
- Group imports: external, internal, relative`,
})
class TypeScriptConventionsSkill extends SkillContext {}
```

### Available Context Methods

`SkillContext` provides:

- `loadInstructions(): Promise<string>` -- load and return the resolved instruction content (resolves file or URL references)
- `build(): Promise<SkillContent>` -- build the full skill content object (instructions + metadata)

## Instruction Sources

Skills support three ways to provide instructions. All three are set via the `instructions` field in `@Skill` metadata.

### Inline String

Provide instructions directly as a string. Best for short, self-contained guides.

```typescript
@Skill({
  name: 'git-commit-guide',
  description: 'Guidelines for writing commit messages',
  instructions: `# Commit Message Format

Use conventional commits: type(scope): description

Types: feat, fix, refactor, test, docs, chore
Scope: the module or area affected
Description: imperative mood, lowercase, no period

Example: feat(auth): add OAuth2 token refresh`,
})
class GitCommitGuideSkill extends SkillContext {}
```

### File Reference

Load instructions from a Markdown file. The path is resolved relative to the file that defines the skill (for both `@Skill` class decorators and `skill()` function calls).

```typescript
// Class-based: path resolves relative to this file's directory
@Skill({
  name: 'architecture-guide',
  description: 'System architecture overview and patterns',
  instructions: { file: './docs/architecture.md' },
})
class ArchitectureGuideSkill extends SkillContext {}

// Function-based: same behavior — path resolves relative to this file's directory
export default skill({
  name: 'architecture-guide',
  description: 'System architecture overview and patterns',
  instructions: { file: './docs/architecture.md' },
});
```

> **Directory structure example:** If this file is at `src/skills/arch.skill.ts`, the instruction file should be at `src/skills/docs/architecture.md`.

### URL Reference

Load instructions from a remote URL. Fetched at build time when the skill is loaded.

```typescript
@Skill({
  name: 'api-standards',
  description: 'REST API design standards',
  instructions: { url: 'https://docs.example.com/standards/api-design.md' },
})
class ApiStandardsSkill extends SkillContext {}
```

## SkillContext: loadInstructions() and build()

The `SkillContext` class resolves instructions regardless of the source type. When the framework serves a skill, it calls `build()` which internally calls `loadInstructions()`.

```typescript
@Skill({
  name: 'onboarding',
  description: 'Developer onboarding checklist',
  instructions: { file: './onboarding-checklist.md' },
})
class OnboardingSkill extends SkillContext {
  // You can override build() to add custom logic
  async build(): Promise<SkillContent> {
    const content = await super.build();
    // Add dynamic content if needed
    return content;
  }
}
```

The `build()` method returns a `SkillContent` object:

```typescript
interface SkillContent {
  id: string; // unique identifier (derived from name if not provided)
  name: string;
  description: string;
  instructions: string; // resolved instruction text
  tools: Array<{ name: string; purpose?: string; required?: boolean }>;
  parameters?: SkillParameter[];
  examples?: Array<{ scenario: string; parameters?: Record<string, unknown>; expectedOutcome?: string }>;
  license?: string;
  compatibility?: string;
  specMetadata?: Record<string, string>;
  allowedTools?: string; // space-delimited pre-approved tools
  resources?: SkillResources; // bundled scripts/, references/, assets/
}
```

## Function Builder

For skills that do not need a class, use the `skill()` function builder. Instruction-only skills have no execute function -- they are purely declarative.

```typescript
import { skill } from '@frontmcp/sdk';

const CodeReviewChecklist = skill({
  name: 'code-review-checklist',
  description: 'Checklist for reviewing pull requests',
  instructions: `# Code Review Checklist

## Correctness
- Does the code do what it claims?
- Are edge cases handled?
- Are error paths covered?

## Style
- Does it follow project conventions?
- Are names descriptive and consistent?
- Is the code self-documenting?

## Testing
- Are there tests for new functionality?
- Do tests cover edge cases?
- Is coverage above 95%?

## Security
- No secrets in code or config?
- Input validation present?
- Proper error handling without leaking internals?`,
  visibility: 'both',
});
```

Register it the same way as a class skill: `skills: [CodeReviewChecklist]`.

The function builder also supports file-based instructions. Relative paths resolve from the file that calls `skill()`:

```typescript
// src/skills/deploy-guide.skill.ts
import { skill } from '@frontmcp/sdk';

export default skill({
  name: 'deploy-guide',
  description: 'Step-by-step deployment checklist',
  instructions: { file: './docs/deploy-guide.md' }, // resolves to src/skills/docs/deploy-guide.md
});
```

## Directory-Based Skills with skillDir()

Use `skillDir()` to load a skill from a directory containing a `SKILL.md` file with YAML frontmatter, plus optional subdirectories for scripts, references, and assets.

### Directory Structure

```text
skills/
  coding-standards/
    SKILL.md           # Instructions with YAML frontmatter
    scripts/
      lint-check.sh    # Helper scripts referenced in instructions
    references/
      patterns.md      # Reference documentation appended to context
    assets/
      diagram.png      # Visual assets
```

### Loading a Skill Directory

```typescript
import { skillDir } from '@frontmcp/sdk';

const CodingStandards = await skillDir('./skills/coding-standards');
```

The `SKILL.md` file uses YAML frontmatter for metadata, followed by the instructions body:

```markdown
---
name: coding-standards
description: Project coding standards and patterns
tags: [standards, conventions, quality]
parameters:
  - name: language
    description: Target programming language
    type: string
    default: typescript
examples:
  - scenario: Apply coding standards to a new module
    expected-outcome: Code follows all project conventions
---

# Coding Standards

Follow these standards when writing code for this project...
```

Files in `scripts/`, `references/`, and `assets/` are automatically bundled with the skill and available in the skill content.

## Parameters

Parameters let callers customize skill behavior. They appear in the skill metadata and can influence how the AI applies the instructions.

```typescript
@Skill({
  name: 'api-design-guide',
  description: 'REST API design guidelines',
  instructions: `# API Design Guide

Design APIs following these conventions.
Adapt the versioning strategy based on the api-style parameter.
Use the auth-required parameter to determine if authentication sections apply.`,
  parameters: [
    { name: 'api-style', description: 'API style to follow', type: 'string', default: 'rest' },
    { name: 'auth-required', description: 'Whether to include auth guidelines', type: 'boolean', default: true },
    { name: 'version-strategy', description: 'API versioning approach', type: 'string', default: 'url-path' },
  ],
})
class ApiDesignGuideSkill extends SkillContext {}
```

## Examples for AI Guidance

Examples show the AI how the skill should be applied and what outcomes to expect:

```typescript
@Skill({
  name: 'error-handling-guide',
  description: 'Error handling patterns and best practices',
  instructions: '...',
  examples: [
    {
      scenario: 'Adding error handling to a new API endpoint',
      expectedOutcome:
        'Endpoint uses specific error classes with MCP error codes, validates input, and returns structured error responses',
    },
    {
      scenario: 'Refactoring try-catch blocks in existing code',
      expectedOutcome: 'Generic catches replaced with specific error types, proper error propagation chain established',
    },
  ],
})
class ErrorHandlingGuideSkill extends SkillContext {}
```

## Visibility

Control where the skill is discoverable using the `visibility` field.

| Value    | Description                                             |
| -------- | ------------------------------------------------------- |
| `'mcp'`  | Visible only via MCP protocol (tool listing)            |
| `'http'` | Visible only via HTTP endpoints (`/llm.txt`, `/skills`) |
| `'both'` | Visible via both MCP and HTTP (default)                 |

```typescript
@Skill({
  name: 'internal-runbook',
  description: 'Internal operations runbook',
  instructions: '...',
  visibility: 'mcp', // Only visible to MCP clients, not HTTP discovery
})
class InternalRunbookSkill extends SkillContext {}
```

### Hiding from Discovery

Use `hideFromDiscovery: true` to register a skill that exists but is not listed in any discovery endpoint. It can still be invoked directly by name.

```typescript
@Skill({
  name: 'admin-procedures',
  description: 'Administrative procedures for internal use',
  instructions: '...',
  hideFromDiscovery: true,
})
class AdminProceduresSkill extends SkillContext {}
```

## Registration

Add skill classes (or function-style skills) to the `skills` array in `@FrontMcp` or `@App`.

```typescript
import { FrontMcp, App } from '@frontmcp/sdk';

@App({
  name: 'standards-app',
  skills: [TypeScriptConventionsSkill, CodeReviewChecklist, CodingStandards],
})
class StandardsApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [StandardsApp],
  skills: [ApiDesignGuideSkill], // can also register skills directly on the server
})
class MyServer {}
```

## HTTP Discovery

When skills have `visibility` set to `'http'` or `'both'`, they are discoverable via HTTP endpoints.

### /llm.txt

Returns a plain-text document listing all HTTP-visible skills with their descriptions and instructions.

```
GET /llm.txt

# Skills

## typescript-conventions
TypeScript coding conventions and patterns for the project
...
```

### /skills

Returns a JSON array of all HTTP-visible skills with full metadata.

```
GET /skills

[
  {
    "name": "typescript-conventions",
    "description": "TypeScript coding conventions and patterns for the project",
    "instructions": "...",
    "parameters": [],
    "tags": [],
    "visibility": "both"
  }
]
```

## Remote and ESM Loading

Load skills from external modules or remote URLs without importing them directly.

**ESM loading** -- load a skill from an ES module:

```typescript
const ExternalGuide = Skill.esm('@my-org/skills@^1.0.0', 'ExternalGuide', {
  description: 'A skill loaded from an ES module',
});
```

**Remote loading** -- load a skill from a remote URL:

```typescript
const CloudGuide = Skill.remote('https://example.com/skills/style-guide', 'CloudGuide', {
  description: 'A skill loaded from a remote server',
});
```

Both return values that can be registered in `skills: [ExternalGuide, CloudGuide]`.

## Nx Generators

Scaffold a new skill using the Nx generators:

```bash
# Create a skill class file
nx generate @frontmcp/nx:skill

# Create a directory-based skill with SKILL.md, scripts/, references/, assets/
nx generate @frontmcp/nx:skill-dir
```

The class generator creates the skill file, spec file, and updates barrel exports. The directory generator creates the full directory structure ready for `skillDir()`.

## Complete Example: Project Onboarding Skill

```typescript
import { Skill, SkillContext, FrontMcp, App, skill, skillDir } from '@frontmcp/sdk';

// Class-based instruction-only skill
@Skill({
  name: 'project-onboarding',
  description: 'Step-by-step guide for onboarding new developers to the project',
  instructions: `# Project Onboarding

## Step 1: Environment Setup
1. Clone the repository
2. Install Node.js 24+ and Yarn
3. Run \`yarn install\` to install dependencies
4. Copy \`.env.example\` to \`.env\` and fill in values

## Step 2: Understand the Architecture
- This is an Nx monorepo with libraries in \`/libs/*\`
- Each library is independently publishable under \`@frontmcp/*\`
- The SDK is the core package; other packages build on it

## Step 3: Run Tests
- Run \`nx run-many -t test\` to verify everything works
- Coverage must be 95%+ across all metrics
- All test files use \`.spec.ts\` extension

## Step 4: Development Workflow
- Create a feature branch from \`main\`
- Follow conventional commit format
- Run \`node scripts/fix-unused-imports.mjs\` before committing
- Ensure all tests pass and no TypeScript warnings exist

## Step 5: Code Standards
- Use strict TypeScript with no \`any\` types
- Use \`unknown\` for generic defaults
- Use specific MCP error classes
- Follow the patterns in CLAUDE.md`,
  parameters: [
    { name: 'team', description: 'Team the developer is joining', type: 'string', required: false },
    {
      name: 'focus-area',
      description: 'Primary area of focus (sdk, cli, adapters, plugins)',
      type: 'string',
      default: 'sdk',
    },
  ],
  examples: [
    {
      scenario: 'Onboard a new developer to the SDK team',
      expectedOutcome: 'Developer has environment set up, understands architecture, and can run tests',
    },
  ],
  tags: ['onboarding', 'setup', 'guide'],
  visibility: 'both',
})
class ProjectOnboardingSkill extends SkillContext {}

// Function-style instruction-only skill
const SecurityChecklist = skill({
  name: 'security-checklist',
  description: 'Security review checklist for code changes',
  instructions: `# Security Checklist

- No secrets or credentials in source code
- Use @frontmcp/utils for all crypto operations
- Validate all external input with Zod schemas
- Use specific error classes that do not leak internals
- Check for SQL injection in any raw queries
- Verify CORS configuration for HTTP endpoints
- Ensure authentication is enforced on protected routes`,
  visibility: 'mcp',
});

// Directory-based instruction-only skill
const ArchitectureGuide = await skillDir('./skills/architecture-guide');

@App({
  name: 'onboarding-app',
  skills: [ProjectOnboardingSkill, SecurityChecklist, ArchitectureGuide],
})
class OnboardingApp {}

@FrontMcp({
  info: { name: 'dev-server', version: '1.0.0' },
  apps: [OnboardingApp],
})
class DevServer {}
```

## Common Patterns

| Pattern                             | Correct                                                | Incorrect                                                | Why                                                                                  |
| ----------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Instruction source for short guides | `instructions: 'Use PascalCase for classes...'`        | Loading a one-paragraph guide from a separate file       | Inline strings keep short skills self-contained and easier to review                 |
| Instruction source for long content | `instructions: { file: './docs/guide.md' }`            | Pasting 200+ lines as a template literal                 | File references keep the class readable and the content editable in Markdown tooling |
| Skill naming                        | `name: 'api-design-guide'` (kebab-case)                | `name: 'ApiDesignGuide'` or `name: 'api design guide'`   | The `name` field must be kebab-case to match registry lookup and URL conventions     |
| Visibility for internal runbooks    | `visibility: 'mcp'`                                    | `visibility: 'both'` for sensitive content               | Internal procedures should not be exposed on public HTTP endpoints like `/llm.txt`   |
| Function builder for simple skills  | `const s = skill({ name, description, instructions })` | Creating a class with an empty body just to use `@Skill` | The function builder avoids boilerplate when no custom `build()` override is needed  |

## Verification Checklist

### Structure

- [ ] Skill has a unique kebab-case `name`
- [ ] `description` is a single sentence explaining what the skill teaches
- [ ] `instructions` field is set (inline string, file reference, or URL reference)
- [ ] No tool references appear in the instructions (instruction-only skill)

### Metadata

- [ ] `tags` array includes relevant categorization keywords
- [ ] `visibility` is set appropriately (`'mcp'`, `'http'`, or `'both'`)
- [ ] `parameters` have `name`, `description`, and `type` defined if present
- [ ] `examples` include `scenario` and `expectedOutcome` if present

### Registration

- [ ] Skill class or function is added to the `skills` array in `@App` or `@FrontMcp`
- [ ] Barrel export (`index.ts`) is updated if the skill is part of a publishable library
- [ ] Test file (`*.spec.ts`) exists and covers metadata and build output

### Discovery

- [ ] Skill appears in `GET /skills` or MCP tool listing based on visibility setting
- [ ] `hideFromDiscovery` is only set to `true` when the skill must be invoked by name only

## Troubleshooting

| Problem                                          | Cause                                                                   | Fix                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Skill does not appear in `/llm.txt` or `/skills` | `visibility` is set to `'mcp'` or `hideFromDiscovery` is `true`         | Set `visibility: 'both'` and `hideFromDiscovery: false`                                |
| `loadInstructions()` returns empty string        | File reference path is wrong or the file is empty                       | Verify the path is relative to the skill file location and the target file has content |
| `build()` throws "instructions required"         | The `instructions` field is missing or `undefined` in `@Skill` metadata | Provide an inline string, `{ file: '...' }`, or `{ url: '...' }`                       |
| Skill parameters are ignored by the AI           | Parameters are declared but not referenced in the instruction text      | Mention each parameter by name in the instructions so the AI knows how to apply them   |
| Directory-based skill missing bundled files      | Subdirectories are not named `scripts/`, `references/`, or `assets/`    | Use the exact conventional directory names; other names are not auto-bundled           |

## Reference

- **Docs:** <https://docs.agentfront.dev/frontmcp/servers/skills>
- **Related skills:** `create-skill-with-tools` (skills that reference MCP tools), `setup-project` (project scaffolding workflows)
