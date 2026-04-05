---
name: skill-name
description: Primary action sentence. Use when [scenario 1], [scenario 2], or [scenario 3].
tags: [category, keyword1, keyword2]
tools:
  - name: tool_name
    purpose: What this tool does in this skill
parameters:
  - name: param_name
    description: What this parameter controls
    type: string
    default: default_value
examples:
  - scenario: When to use this skill
    expected-outcome: What the user should see after completion
priority: 7
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/...
---

# Skill Title

One-paragraph overview of what this skill accomplishes and its role in the FrontMCP ecosystem.

## When to Use This Skill

### Must Use

- Scenario where this is the only correct skill to apply
- Another mandatory scenario

### Recommended

- Scenario where this skill helps but alternatives exist
- Helpful but optional scenario

### Skip When

- Scenario where another skill is the better choice (see `other-skill-name`)
- Situation where this skill does not apply

> **Decision:** One-liner summarizing when to pick this skill over alternatives.

## Prerequisites

- Required packages or tools
- Prior skills that should be completed first (see `prerequisite-skill`)

## Steps

### Step 1: First Action

Describe the first step with code examples:

```typescript
// Example code
```

### Step 2: Second Action

Continue with subsequent steps.

## Common Patterns

<!-- Include this section only for skills with clear right/wrong usage patterns -->

| Pattern         | Correct                  | Incorrect      | Why                                  |
| --------------- | ------------------------ | -------------- | ------------------------------------ |
| Decorator usage | `@Tool({ name: '...' })` | `@Tool('...')` | Decorator requires an options object |

## Verification Checklist

### Configuration

- [ ] Config item verified
- [ ] Dependencies installed

### Runtime

- [ ] Feature works as expected
- [ ] Error cases handled

## Troubleshooting

| Problem              | Cause          | Solution      |
| -------------------- | -------------- | ------------- |
| Common error message | Why it happens | How to fix it |

## Examples

Each reference file has a corresponding `examples/<reference-name>/` directory with standalone, copy-pasteable examples.

### Example file structure

````markdown
---
name: example-name
reference: parent-reference-name
level: basic | intermediate | advanced
description: One sentence describing the exact scenario this example covers.
tags: [keyword1, keyword2, keyword3]
features:
  - Concrete API or pattern this example demonstrates
  - Another concrete behavior shown in the code
---

# Example Title

One sentence expanding slightly on the frontmatter description.

## Code

\```typescript
// src/path/to/file.ts
import { ... } from '@frontmcp/sdk';
// Complete, self-contained code
\```

## What This Demonstrates

- Key pattern or API shown

## Related

- See `reference-name` for the full API reference
````

Use the example file frontmatter as the single source of truth for example metadata. Reference `## Examples` tables and `skills-manifest.json` should mirror `name`, `level`, `description`, `tags`, and `features` from the example file.

### Linking from references

Add a `## Examples` section at the bottom of each reference file (before `## Reference`):

```markdown
## Examples

| Example                                                      | Level | Description   |
| ------------------------------------------------------------ | ----- | ------------- |
| [`example-name`](../examples/reference-name/example-name.md) | Basic | What it shows |

> See all examples in [`examples/reference-name/`](../examples/reference-name/)
```

## Resource Access

Skills are accessible via the `skills://` URI scheme as MCP resources with auto-complete:

| URI                                               | Returns                                   |
| ------------------------------------------------- | ----------------------------------------- |
| `skills://catalog`                                | JSON list of all available skills         |
| `skills://{skillName}`                            | Full SKILL.md content (formatted for LLM) |
| `skills://{skillName}/SKILL.md`                   | Same as above (explicit path alias)       |
| `skills://{skillName}/references`                 | JSON list of references for this skill    |
| `skills://{skillName}/references/{referenceName}` | Reference markdown content                |
| `skills://{skillName}/examples`                   | JSON list of examples for this skill      |
| `skills://{skillName}/examples/{exampleName}`     | Example markdown content                  |

## Reference

- [Documentation](https://docs.agentfront.dev/frontmcp/...)
- Related skills: `related-skill-a`, `related-skill-b`
