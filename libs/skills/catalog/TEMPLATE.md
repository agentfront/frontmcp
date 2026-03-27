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

## Reference

- [Documentation](https://docs.agentfront.dev/frontmcp/...)
- Related skills: `related-skill-a`, `related-skill-b`
