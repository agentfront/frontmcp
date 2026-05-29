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

Skills are accessible via the `skill://` URI scheme as MCP resources per
[SEP-2640 (Skills Extension)](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640),
with auto-complete on `skillPath`:

| URI                                        | Returns                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `skill://index.json`                       | SEP-2640 discovery document (agentskills.io schema)                      |
| `skill://{skillPath}/SKILL.md`             | Raw SKILL.md (YAML frontmatter + markdown body, identical to filesystem) |
| `skill://{skillPath}/references/{file}.md` | Reference markdown content                                               |
| `skill://{skillPath}/examples/{file}.md`   | Example markdown content                                                 |
| `skill://{skillPath}/scripts/{file}`       | Script asset (any media type)                                            |
| `skill://{skillPath}/assets/{file}`        | Bundled asset (any media type)                                           |

`{skillPath}` may be a single segment (`git-workflow`) or nested
(`acme/billing/refunds`). Its final segment must equal the skill's
frontmatter `name`.

## Reference

- [Documentation](https://docs.agentfront.dev/frontmcp/...)
- Related skills: `related-skill-a`, `related-skill-b`

---

## Alternative: `layout: 'component'`

The template above describes the **router layout** (`layout: 'router'`, the default) — a Scenario Routing Table SKILL.md, `references/<topic>.md` files, and examples grouped under `examples/<topic>/<example>.md`.

For per-thing skills (`create-tool`, `create-resource`, `create-prompt`, etc.) use the **component layout** instead. Opt in by setting `layout: component` in the manifest entry. Differences:

| Aspect               | Router layout (default)                                           | Component layout                                                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| SKILL.md frontmatter | Minimal — `name`, `description`, optional `priority`/`visibility` | **Rich** — multi-line `description:` with an explicit `Triggers:` list, `paths:` glob array, `when_to_use` block, top-level `priority`/`visibility`/`tags`/`category`. Designed for Claude Code's auto-discovery heuristics. |
| `examples/`          | Grouped: `examples/<reference>/<example>.md`                      | Flat: `examples/<example>.md`                                                                                                                                                                                                |
| `rules/`             | Not used                                                          | `rules/<rule>.md` — short DO/DON'T constraint files with `name`, `constraint`, `severity: required                                                                                                                           | recommended` frontmatter |
| Manifest entry       | `references[].examples[]`                                         | Top-level `examples[]` + top-level `rules[]`                                                                                                                                                                                 |
| SKILL.md body        | "Scenario Routing Table" pointing at references                   | "Scenario Routing Table" pointing at examples + a `Rules` table pointing at `rules/*.md`                                                                                                                                     |

Every example file MUST still satisfy the same alignment invariants enforced by `skills-validation.spec.ts`:

- Frontmatter `description` = first paragraph after the H1.
- Frontmatter `features` = bullets under `## What This Demonstrates`.
- Manifest example entry `description` / `level` / `tags` / `features` = the file's frontmatter.

For component-layout skills the manifest sync extends to `rules[]`: the rule file's frontmatter `constraint` and `severity` must match the manifest entry.

See `create-tool/SKILL.md` for a complete working example of the component layout.
