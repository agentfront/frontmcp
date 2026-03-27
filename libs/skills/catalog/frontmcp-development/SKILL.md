---
name: frontmcp-development
description: "Domain router for building MCP components \u2014 tools, resources, prompts, agents, providers, jobs, workflows, and skills. Use when starting any FrontMCP development task and need to find the right skill."
tags: [router, development, tools, resources, prompts, agents, skills, guide]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/servers/overview
---

# FrontMCP Development Router

Entry point for building MCP server components. This skill helps you find the right development skill based on what you want to build. It does not teach implementation details itself — it routes you to the specific skill that does.

## When to Use This Skill

### Must Use

- Starting a FrontMCP development task and unsure which component type to build (tool vs resource vs prompt vs agent)
- Onboarding to the FrontMCP development model and need an overview of all building blocks
- Planning a feature that may require multiple component types working together

### Recommended

- Looking up the canonical name of a development skill to install or search
- Comparing component types to decide which fits your use case
- Understanding how tools, resources, prompts, agents, and skills relate to each other

### Skip When

- You already know which component to build (go directly to `create-tool`, `create-resource`, etc.)
- You need to configure server settings, not build components (see `frontmcp-config`)
- You need to deploy or build, not develop (see `frontmcp-deployment`)

> **Decision:** Use this skill when you need to figure out WHAT to build. Use the specific skill when you already know.

## Scenario Routing Table

| Scenario                                                 | Skill                     | Description                                                                         |
| -------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| Expose an executable action that AI clients can call     | `create-tool`             | Class-based or function-style tools with Zod input/output validation                |
| Expose read-only data via a URI                          | `create-resource`         | Static resources or URI template resources for dynamic data                         |
| Create a reusable conversation template or system prompt | `create-prompt`           | Prompt entries with arguments and multi-turn message sequences                      |
| Build an autonomous AI loop that orchestrates tools      | `create-agent`            | Agent entries with LLM config, inner tools, and swarm handoff                       |
| Register shared services or configuration via DI         | `create-provider`         | Dependency injection tokens, lifecycle hooks, factory providers                     |
| Run a background task with progress and retries          | `create-job`              | Job entries with attempt tracking, retry config, and progress                       |
| Chain multiple jobs into a sequential pipeline           | `create-workflow`         | Workflow entries that compose jobs with data passing                                |
| Write instruction-only AI guidance (no code execution)   | `create-skill`            | Skill entries with markdown instructions from files, strings, or URLs               |
| Write AI guidance that also orchestrates tools           | `create-skill-with-tools` | Skill entries that combine instructions with registered tools                       |
| Look up any decorator signature or option                | `decorators-guide`        | Complete reference for @Tool, @Resource, @Prompt, @Agent, @App, @FrontMcp, and more |

## Recommended Reading Order

1. **`decorators-guide`** — Start here to understand the full decorator landscape
2. **`create-tool`** — The most common building block; learn tools first
3. **`create-resource`** — Expose data alongside tools
4. **`create-prompt`** — Add reusable conversation templates
5. **`create-provider`** — Share services across tools and resources via DI
6. **`create-agent`** — Build autonomous AI loops (advanced)
7. **`create-job`** / **`create-workflow`** — Background processing (advanced)
8. **`create-skill`** / **`create-skill-with-tools`** — Author your own skills (meta)

## Cross-Cutting Patterns

| Pattern           | Applies To                        | Rule                                                                                   |
| ----------------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| Naming convention | Tools                             | Use `snake_case` for tool names (`get_weather`, not `getWeather`)                      |
| Naming convention | Skills, resources                 | Use `kebab-case` for skill and resource names                                          |
| File naming       | All components                    | Use `<name>.<type>.ts` pattern (e.g., `fetch-weather.tool.ts`)                         |
| DI access         | Tools, resources, prompts, agents | Use `this.get(TOKEN)` (throws) or `this.tryGet(TOKEN)` (returns undefined)             |
| Error handling    | All components                    | Use `this.fail(err)` with MCP error classes, not raw `throw`                           |
| Input validation  | Tools                             | Always use Zod raw shapes (not `z.object()`) for `inputSchema`                         |
| Output validation | Tools                             | Always define `outputSchema` to prevent data leaks                                     |
| Registration      | All components                    | Add to `tools`, `resources`, `prompts`, `agents`, etc. arrays in `@App` or `@FrontMcp` |
| Test files        | All components                    | Use `.spec.ts` extension, never `.test.ts`                                             |

## Common Patterns

| Pattern                 | Correct                                                   | Incorrect                                                | Why                                                                   |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Choosing component type | Tool for actions, Resource for data, Prompt for templates | Using a tool to return static data                       | Each type has protocol-level semantics; misuse confuses AI clients    |
| Component registration  | Register in `@App` arrays, compose apps in `@FrontMcp`    | Register tools directly in `@FrontMcp` without an `@App` | Apps provide modularity; direct registration bypasses app-level hooks |
| Shared logic            | Extract to a `@Provider` and inject via DI                | Duplicate code across multiple tools                     | Providers are testable, lifecycle-managed, and scoped                 |
| Complex orchestration   | Use `@Agent` with inner tools                             | Chain tool calls manually in a single tool               | Agents handle LLM loops, retries, and tool selection automatically    |
| Background work         | Use `@Job` with retry config                              | Run long tasks inside a tool's `execute()`               | Jobs have progress tracking, attempt awareness, and timeout handling  |

## Verification Checklist

### Architecture

- [ ] Each component type matches its semantic purpose (action=tool, data=resource, template=prompt)
- [ ] Shared services use `@Provider` with DI tokens, not module-level singletons
- [ ] Components are registered in `@App` arrays, apps composed in `@FrontMcp`

### Development Workflow

- [ ] Files follow `<name>.<type>.ts` naming convention
- [ ] Each component has a corresponding `.spec.ts` test file
- [ ] `decorators-guide` consulted for unfamiliar decorator options

## Troubleshooting

| Problem                                  | Cause                                          | Solution                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Unsure which component type to use       | Requirements are ambiguous                     | Check the Scenario Routing Table above; if the action modifies state, use a tool; if it returns data by URI, use a resource |
| Component not discovered at runtime      | Not registered in `@App` or `@FrontMcp` arrays | Add to the appropriate array (`tools`, `resources`, `prompts`, etc.)                                                        |
| DI token not resolving                   | Provider not registered in scope               | Register the provider in the `providers` array of the same `@App`                                                           |
| Need both AI guidance and tool execution | Used `create-skill` but need tools too         | Switch to `create-skill-with-tools` which combines instructions with registered tools                                       |

## Reference

- [Server Overview](https://docs.agentfront.dev/frontmcp/servers/overview)
- Related skills: `create-tool`, `create-resource`, `create-prompt`, `create-agent`, `create-provider`, `create-job`, `create-workflow`, `create-skill`, `create-skill-with-tools`, `decorators-guide`
