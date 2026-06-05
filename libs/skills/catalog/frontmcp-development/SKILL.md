---
name: frontmcp-development
description: 'Use when building any FrontMCP server component other than a tool (for tools, use create-tool). Covers @Resource static resources and parameterized URI templates; @Prompt reusable prompts (RAG, multi-turn); @Provider singleton dependency-injection providers (database pools, API clients); @Agent autonomous LLM agents (Anthropic, OpenAI) and swarms; @Job background jobs (retry, progress, permissions) and @Workflow DAG pipelines; framework adapters and the OpenAPI adapter (turn OpenAPI 3.x specs into MCP tools with auth, polling, transforms); plugins, plugin lifecycle hooks (before / after / around / stage), and the official plugins; instruction-only skills and skills that reference tools; and the hierarchical decorator system from @FrontMcp down to @App. Triggers: create a resource, build a prompt, write a provider, add an agent, job, workflow, plugin, adapter, or OpenAPI integration.'
when_to_use: |
  Trigger when creating or editing a non-tool FrontMCP component: a
  *.resource.ts, *.prompt.ts, *.provider.ts, *.agent.ts, *.job.ts,
  *.workflow.ts, *.plugin.ts, or *.skill.ts file, or adding @Resource, @Prompt,
  @Provider, @Agent, @Job, @Workflow, a plugin, an adapter, or an OpenAPI
  integration. For tools (*.tool.ts) use create-tool instead.
paths: '**/*.resource.ts, **/*.prompt.ts, **/*.provider.ts, **/*.agent.ts, **/*.job.ts, **/*.workflow.ts, **/*.plugin.ts, **/*.skill.ts'
tags: [router, development, tools, resources, prompts, agents, skills, guide]
category: development
targets: [all]
bundle: [recommended, minimal, full]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/fundamentals/overview
---

# FrontMCP Development Router

Entry point for building MCP server components. This skill helps you find the right development reference based on what you want to build. It does not teach implementation details itself — it routes you to the specific reference (under `references/`) that does.

## When to Use This Skill

### Must Use

- Starting a FrontMCP development task and unsure which component type to build (tool vs resource vs prompt vs agent)
- Onboarding to the FrontMCP development model and need an overview of all building blocks
- Planning a feature that may require multiple component types working together

### Recommended

- Looking up the canonical name of a development reference to install or search
- Comparing component types to decide which fits your use case
- Understanding how tools, resources, prompts, agents, and skills relate to each other

### Skip When

- You already know which component to build (go directly to `create-tool`, `create-resource`, etc.)
- You need to configure server settings, not build components (see `frontmcp-config`)
- You need to deploy or build, not develop (see `frontmcp-deployment`)

> **Decision:** Use this skill when you need to figure out WHAT to build. Open the matching reference under `references/` directly when you already know.

## Prerequisites

- A scaffolded FrontMCP project (see `frontmcp-setup` if you don't have one).
- Familiarity with TypeScript decorators and Zod schemas — every component is decorator-driven and validates I/O via Zod.
- Decide whether you're adding to an existing `@App` or composing a new one (multi-app projects: see `multi-app-composition`).

## Steps

This is a router skill. The "steps" here are how to choose the right reference (a markdown file under `references/`), not how to implement a component.

1. **Identify the component type** using the Scenario Routing Table below.
2. **Open the matching reference** (e.g. `references/create-tool.md`, `references/create-resource.md`) and follow its Steps section.
3. **Compose**, if needed: most non-trivial features need two or more components (e.g. tool + provider, resource + adapter). Read each reference independently before wiring them together.
4. **Test before integration** (`frontmcp-testing`) — every component type has a unit-test recipe.

## Scenario Routing Table

| Scenario                                                                                                                                                                                        | Reference                                                      | Description                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expose an executable action that AI clients can call (full surface: schemas, DI, errors, throttling, auth, availability, elicitation, UI widgets, annotations, examples metadata, registration) | **[`create-tool` (top-level skill)](../create-tool/SKILL.md)** | Single source of truth for everything inside `@Tool({...})`. Subsumes the former `create-tool`, `create-tool-annotations`, `create-tool-output-schema-types`, and `create-tool-ui` references. |
| Expose read-only data via a URI                                                                                                                                                                 | `create-resource`                                              | Static resources or URI template resources for dynamic data                                                                                                                                    |
| Create a reusable conversation template or system prompt                                                                                                                                        | `create-prompt`                                                | Prompt entries with arguments and multi-turn message sequences                                                                                                                                 |
| Build an autonomous AI loop that orchestrates tools                                                                                                                                             | `create-agent`                                                 | Agent entries with LLM config, inner tools, and swarm handoff                                                                                                                                  |
| Register shared services or configuration via DI                                                                                                                                                | `create-provider`                                              | Dependency injection tokens, lifecycle hooks, factory providers                                                                                                                                |
| Run a background task with progress and retries                                                                                                                                                 | `create-job`                                                   | Job entries with attempt tracking, retry config, and progress                                                                                                                                  |
| Chain multiple jobs into a sequential pipeline                                                                                                                                                  | `create-workflow`                                              | Workflow entries that compose jobs with data passing                                                                                                                                           |
| Write instruction-only AI guidance (no code execution)                                                                                                                                          | `create-skill`                                                 | Skill entries with markdown instructions from files, strings, or URLs                                                                                                                          |
| Write AI guidance that also orchestrates tools                                                                                                                                                  | `create-skill-with-tools`                                      | Skill entries that combine instructions with registered tools                                                                                                                                  |
| Look up any decorator signature or option                                                                                                                                                       | `decorators-guide`                                             | Complete reference for @Tool, @Resource, @Prompt, @Agent, @App, @FrontMcp, and more                                                                                                            |
| Overview of all official adapters                                                                                                                                                               | `official-adapters`                                            | Router to all adapter types; adapter vs plugin comparison                                                                                                                                      |
| Integrate an external API via OpenAPI spec                                                                                                                                                      | `openapi-adapter`                                              | OpenapiAdapter with auth, polling, filtering, transforms, format resolution, $ref security                                                                                                     |
| Use official plugins (caching, remember, feature flags)                                                                                                                                         | `official-plugins`                                             | Built-in plugins for caching, session memory, approval, and feature flags (dashboard is beta)                                                                                                  |
| Connect to an external data source via a custom adapter                                                                                                                                         | `create-adapter`                                               | Create custom adapters for external data sources                                                                                                                                               |
| Configure LLM settings for an agent component                                                                                                                                                   | `create-agent-llm-config`                                      | Configure LLM settings for agent components                                                                                                                                                    |
| Add will/did/around lifecycle hooks to a plugin                                                                                                                                                 | `create-plugin-hooks`                                          | Add lifecycle hooks to plugins (will/did/around)                                                                                                                                               |

## Recommended Reading Order

1. **`decorators-guide`** — Start here to understand the full decorator landscape
2. **[`create-tool`](../create-tool/SKILL.md)** — The most common building block (top-level skill — covers schemas, DI, errors, throttling, auth, UI widgets, annotations); learn tools first
3. **`create-resource`** — Expose data alongside tools
4. **`create-prompt`** — Add reusable conversation templates
5. **`create-provider`** — Share services across tools and resources via DI
6. **`create-agent`** — Build autonomous AI loops (advanced)
7. **`create-job`** / **`create-workflow`** — Background processing (advanced)
8. **`create-skill`** / **`create-skill-with-tools`** — Author your own skills (meta)
9. **`official-adapters`** / **`openapi-adapter`** — Integrate external APIs via OpenAPI specs
10. **`official-plugins`** — Add caching, session memory, feature flags, and more

## Cross-Cutting Patterns

| Pattern           | Applies To                        | Rule                                                                                                                                                                                                                                                                                                                 |
| ----------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Naming convention | Tools                             | Use `snake_case` for tool names (`get_weather`, not `getWeather`)                                                                                                                                                                                                                                                    |
| Naming convention | Skills, resources                 | Use `kebab-case` for skill and resource names                                                                                                                                                                                                                                                                        |
| File naming       | All components                    | Use `<name>.<type>.ts` pattern (e.g., `fetch-weather.tool.ts`)                                                                                                                                                                                                                                                       |
| DI access         | Tools, resources, prompts, agents | Use `this.get(TOKEN)` (throws) or `this.tryGet(TOKEN)` (returns undefined)                                                                                                                                                                                                                                           |
| Error handling    | All components                    | Use `this.fail(err)` with MCP error classes, not raw `throw`                                                                                                                                                                                                                                                         |
| Input validation  | Tools                             | Always use Zod raw shapes (not `z.object()`) for `inputSchema`                                                                                                                                                                                                                                                       |
| Output validation | Tools                             | Always define `outputSchema` to prevent data leaks                                                                                                                                                                                                                                                                   |
| Registration      | All components                    | **Best practice:** register components in their owning `@App`. `@FrontMcp` also accepts entity arrays at the top level (`tools`, `resources`, `skills`, `providers`, `plugins`, `jobs`, `channels`, `authorities`) for simple single-app servers, but `@App` provides modularity, per-app auth, and lifecycle hooks. |
| Test files        | All components                    | Use `.spec.ts` extension, never `.test.ts`                                                                                                                                                                                                                                                                           |

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

## Examples

Each reference has matching examples under [`examples/<reference>/`](./examples/):

### `create-adapter`

| Example                                                                 | Level        | Description                                                                                                             |
| ----------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| [`basic-api-adapter`](./examples/create-adapter/basic-api-adapter.md)   | Basic        | A minimal adapter that fetches operation definitions from an external API and generates MCP tools.                      |
| [`namespaced-adapter`](./examples/create-adapter/namespaced-adapter.md) | Intermediate | An adapter that namespaces generated tools to avoid collisions and includes proper error handling for startup failures. |

### `create-agent-llm-config`

| Example                                                                      | Level | Description                                                                |
| ---------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| [`anthropic-config`](./examples/create-agent-llm-config/anthropic-config.md) | Basic | Configuring an agent with the Anthropic provider and common model options. |
| [`openai-config`](./examples/create-agent-llm-config/openai-config.md)       | Basic | Configuring an agent with the OpenAI provider and different model options. |

### `create-agent`

| Example                                                                           | Level        | Description                                                                                       |
| --------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| [`basic-agent-with-tools`](./examples/create-agent/basic-agent-with-tools.md)     | Basic        | An autonomous agent that uses inner tools to review GitHub pull requests.                         |
| [`custom-multi-pass-agent`](./examples/create-agent/custom-multi-pass-agent.md)   | Intermediate | An agent that overrides `execute()` to perform multi-pass LLM reasoning with `this.completion()`. |
| [`nested-agents-with-swarm`](./examples/create-agent/nested-agents-with-swarm.md) | Advanced     | Composing specialized sub-agents and configuring swarm-based handoff between agents.              |

### `create-job`

| Example                                                                 | Level        | Description                                                                                                        |
| ----------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| [`basic-report-job`](./examples/create-job/basic-report-job.md)         | Basic        | A minimal job that generates a report with progress tracking and structured output.                                |
| [`job-with-permissions`](./examples/create-job/job-with-permissions.md) | Advanced     | A data export job with declarative permission controls, plus a function-style job for simple tasks.                |
| [`job-with-retry`](./examples/create-job/job-with-retry.md)             | Intermediate | A job that syncs data from an external API with automatic retry, exponential backoff, and batch progress tracking. |

### `create-plugin-hooks`

| Example                                                                                                              | Level        | Description                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-logging-plugin`](./examples/create-plugin-hooks/basic-logging-plugin.md)                                     | Basic        | Demonstrates a plugin that logs tool execution using `@Will` and `@Did` hook decorators from the pre-built `ToolHook` export.                                                                                 |
| [`caching-with-around`](./examples/create-plugin-hooks/caching-with-around.md)                                       | Intermediate | Demonstrates wrapping tool execution with an `@Around` hook to implement result caching with TTL-based expiry.                                                                                                |
| [`tool-level-hooks-and-stage-replacement`](./examples/create-plugin-hooks/tool-level-hooks-and-stage-replacement.md) | Advanced     | Demonstrates two advanced patterns: adding `@Will`/`@Did` hooks directly on a `@Tool` class (scoped to that tool only), and using `@Stage` in a plugin to replace a flow stage entirely with a filtered mock. |

### `create-plugin`

| Example                                                                                      | Level        | Description                                                                                                               |
| -------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`basic-plugin-with-provider`](./examples/create-plugin/basic-plugin-with-provider.md)       | Basic        | A minimal plugin that contributes an injectable service via the `providers` and `exports` arrays.                         |
| [`configurable-dynamic-plugin`](./examples/create-plugin/configurable-dynamic-plugin.md)     | Advanced     | A plugin that accepts runtime configuration via `DynamicPlugin` and extends decorator metadata with custom fields.        |
| [`plugin-with-context-extension`](./examples/create-plugin/plugin-with-context-extension.md) | Intermediate | A plugin that adds a `this.auditLog` property to all execution contexts using context extensions and module augmentation. |

### `create-prompt`

| Example                                                                            | Level        | Description                                                                                          |
| ---------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| [`basic-prompt`](./examples/create-prompt/basic-prompt.md)                         | Basic        | A simple prompt that generates a structured code review message from user-provided arguments.        |
| [`dynamic-rag-prompt`](./examples/create-prompt/dynamic-rag-prompt.md)             | Advanced     | A prompt that queries a knowledge base via DI to build context-aware messages at runtime.            |
| [`multi-turn-debug-session`](./examples/create-prompt/multi-turn-debug-session.md) | Intermediate | A prompt that uses alternating user/assistant messages to guide a structured debugging conversation. |

### `create-provider`

| Example                                                                              | Level        | Description                                                                                           |
| ------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------- |
| [`basic-database-provider`](./examples/create-provider/basic-database-provider.md)   | Basic        | A provider that manages a database connection pool with `onInit()` and `onDestroy()` lifecycle hooks. |
| [`config-and-api-providers`](./examples/create-provider/config-and-api-providers.md) | Intermediate | A configuration provider with readonly environment settings and an HTTP API client provider.          |

### `create-resource`

| Example                                                                              | Level        | Description                                                                          |
| ------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------ |
| [`basic-static-resource`](./examples/create-resource/basic-static-resource.md)       | Basic        | A static resource that exposes application configuration at a fixed URI.             |
| [`binary-and-multi-content`](./examples/create-resource/binary-and-multi-content.md) | Advanced     | A resource serving binary blob data and a resource returning multiple content items. |
| [`parameterized-template`](./examples/create-resource/parameterized-template.md)     | Intermediate | A resource template with typed URI parameters and argument autocompletion.           |

### `create-skill-with-tools`

| Example                                                                                          | Level        | Description                                                                                                          |
| ------------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| [`basic-tool-orchestration`](./examples/create-skill-with-tools/basic-tool-orchestration.md)     | Basic        | A skill that guides an AI client through a deploy workflow using referenced MCP tools.                               |
| [`directory-skill-with-tools`](./examples/create-skill-with-tools/directory-skill-with-tools.md) | Advanced     | A directory-based skill loaded with `skillDir()`, plus a class-based skill using Agent Skills spec metadata fields.  |
| [`incident-response-skill`](./examples/create-skill-with-tools/incident-response-skill.md)       | Intermediate | A skill that uses object-style tool references with purpose descriptions and required flags, plus strict validation. |

### `create-skill`

| Example                                                                     | Level        | Description                                                                                                             |
| --------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| [`basic-inline-skill`](./examples/create-skill/basic-inline-skill.md)       | Basic        | A minimal instruction-only skill with inline content and the function builder alternative.                              |
| [`directory-based-skill`](./examples/create-skill/directory-based-skill.md) | Advanced     | A skill loaded from a directory structure with SKILL.md frontmatter, plus file-based and URL-based instruction sources. |
| [`parameterized-skill`](./examples/create-skill/parameterized-skill.md)     | Intermediate | A skill with customizable parameters, usage examples for AI guidance, and controlled visibility.                        |

### `create-tool` (migrated to top-level skill)

The full `@Tool({...})` surface — including the former `create-tool-annotations`, `create-tool-output-schema-types`, and `create-tool-ui` references — now lives in the top-level [`create-tool`](../create-tool/SKILL.md) skill. See its [`examples/`](../create-tool/examples/) directory for 25 combination examples covering schemas, DI, errors, throttling, auth, availability, elicitation, UI widgets, annotations, examples metadata, and job hand-off.

### `create-workflow`

| Example                                                                                      | Level        | Description                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-deploy-pipeline`](./examples/create-workflow/basic-deploy-pipeline.md)               | Basic        | A linear workflow that builds, tests, and deploys a service with step dependencies and dynamic input.                             |
| [`parallel-validation-pipeline`](./examples/create-workflow/parallel-validation-pipeline.md) | Intermediate | A workflow that validates multiple datasets in parallel, then conditionally merges results or notifies on failure.                |
| [`webhook-triggered-workflow`](./examples/create-workflow/webhook-triggered-workflow.md)     | Advanced     | A CI/CD workflow triggered by a webhook, featuring `continueOnError`, per-step conditions, and the `workflow()` function builder. |

### `decorators-guide`

| Example                                                                                                       | Level        | Description                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`agent-skill-job-workflow`](./examples/decorators-guide/agent-skill-job-workflow.md)                         | Advanced     | Demonstrates the advanced decorator types: `@Agent` for autonomous AI agents, `@Skill` for knowledge packages, `@Job` for background tasks, and `@Workflow` for multi-step orchestration. |
| [`basic-server-with-app-and-tools`](./examples/decorators-guide/basic-server-with-app-and-tools.md)           | Basic        | Demonstrates the minimal decorator hierarchy to create a working FrontMCP server with one app containing a tool and a resource.                                                           |
| [`multi-app-with-plugins-and-providers`](./examples/decorators-guide/multi-app-with-plugins-and-providers.md) | Intermediate | Demonstrates a server with multiple `@App` modules, a `@Provider` for dependency injection, and a `@Plugin` for cross-cutting concerns.                                                   |

### `openapi-adapter`

| Example                                                                                                          | Level        | Description                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-openapi-adapter`](./examples/openapi-adapter/basic-openapi-adapter.md)                                   | Basic        | Demonstrates converting an OpenAPI specification into MCP tools automatically using `OpenapiAdapter` with minimal configuration.                              |
| [`authenticated-adapter-with-polling`](./examples/openapi-adapter/authenticated-adapter-with-polling.md)         | Intermediate | Demonstrates configuring authentication (API key and bearer token) and automatic spec polling for OpenAPI adapters.                                           |
| [`format-resolution-and-custom-resolvers`](./examples/openapi-adapter/format-resolution-and-custom-resolvers.md) | Intermediate | Demonstrates using built-in and custom format resolvers to enrich tool input schemas with concrete constraints from OpenAPI format values.                    |
| [`ref-security-and-filtering`](./examples/openapi-adapter/ref-security-and-filtering.md)                         | Intermediate | Demonstrates configuring $ref resolution security to prevent SSRF attacks and filtering which API operations become MCP tools.                                |
| [`multi-api-hub-with-inline-spec`](./examples/openapi-adapter/multi-api-hub-with-inline-spec.md)                 | Advanced     | Demonstrates registering multiple OpenAPI adapters from different APIs in a single app, including one with an inline spec definition instead of a remote URL. |

### `official-plugins`

| Example                                                                                           | Level        | Description                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`cache-and-feature-flags`](./examples/official-plugins/cache-and-feature-flags.md)               | Intermediate | Demonstrates combining the Cache plugin for tool result caching with the Feature Flags plugin for gating tools behind flags.                                                 |
| [`production-multi-plugin-setup`](./examples/official-plugins/production-multi-plugin-setup.md)   | Advanced     | Demonstrates a production-ready server configuration combining CodeCall, Remember, Approval, Cache, and Feature Flags plugins with Redis storage and external flag services. |
| [`remember-plugin-session-memory`](./examples/official-plugins/remember-plugin-session-memory.md) | Basic        | Demonstrates installing the Remember plugin and using `this.remember` in tools to store and retrieve session memory.                                                         |

## Accessing This Skill

Skills are distributed as plain SKILL.md files plus a sibling `references/`
and `examples/` tree, so consumers can pick whichever access mode fits:

| Mode               | How it works                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**     | Read `libs/skills/catalog/frontmcp-development/` directly from a clone of the catalog repo, or from a published `@frontmcp/skills` install. SKILL.md is the entry point.                                                                                                                                                                                  |
| **`frontmcp` CLI** | `frontmcp skills list`, `frontmcp skills read frontmcp-development`, `frontmcp skills read frontmcp-development:references/<file>.md`, `frontmcp skills install frontmcp-development` — no server required.                                                                                                                                               |
| **MCP `skill://`** | When a developer mounts this skill into their own FrontMCP server (`@FrontMcp({ skills: [...] })`), the SDK exposes it via SEP-2640 resources: `skill://frontmcp-development/SKILL.md`, `skill://frontmcp-development/references/{file}.md`, etc. The server’s `skill://index.json` returns the SEP-2640 discovery document for everything mounted on it. |

The catalog itself is **not** an MCP server. The `skill://` URIs only resolve
when a server has been configured to host this skill.

## Reference

- [FrontMCP Overview](https://docs.agentfront.dev/frontmcp/fundamentals/overview)
- Related skills: [`create-tool`](../create-tool/SKILL.md) (top-level), `create-resource`, `create-prompt`, `create-agent`, `create-provider`, `create-job`, `create-workflow`, `create-skill`, `create-skill-with-tools`, `decorators-guide`, `official-adapters`, `openapi-adapter`, `official-plugins`
