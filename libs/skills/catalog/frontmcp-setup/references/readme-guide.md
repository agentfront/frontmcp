---
name: readme-guide
description: Generate deployment-target-aware README.md files for FrontMCP MCP servers
---

# FrontMCP README Generator

Generate deployment-target-aware README.md files for FrontMCP MCP servers. The README adapts its content based on how the project is intended to be consumed — as an npm package, CLI tool, browser SDK, or serverless deployment.

## When to Use This Skill

### Must Use

- Creating a new FrontMCP project that will be published or shared
- Preparing an open-source release of an MCP server
- Updating README after adding tools, prompts, resources, or changing deployment targets

### Recommended

- After significant changes to tools, resources, or server configuration
- When switching deployment targets (e.g., from Node to Vercel)
- Before publishing a new version to npm

### Skip When

- Internal project with no external users
- The README is already comprehensive and manually maintained

> **Decision:** Use this skill whenever the project's README needs to reflect its current tools, capabilities, and deployment instructions. Always ask the user which deployment target they're publishing for.

## Step 1: Determine the Deployment Target

Ask the user how the project will be consumed. This determines the README structure:

| Target                          | README Focus                                                   |
| ------------------------------- | -------------------------------------------------------------- |
| **npm package** (direct client) | Installation via npm, SDK usage, `create()` API examples       |
| **CLI binary**                  | Global install, CLI commands, configuration, usage examples    |
| **Browser SDK**                 | CDN/bundler import, browser-compatible API, framework examples |
| **Node server** (Docker)        | Docker setup, environment variables, health checks, deployment |
| **Vercel**                      | One-click deploy, `vercel.json` config, environment setup      |
| **Lambda**                      | SAM template, deployment commands, API Gateway config          |
| **Cloudflare Workers**          | `wrangler.toml` config, deploy commands, edge runtime notes    |

## Step 2: Gather Project Information

Read these files to understand the project:

1. **`src/main.ts`** — Server name, version, registered apps
2. **`src/**/\*.app.ts`\*\* — App names and their tools/resources/prompts
3. **`src/tools/*.tool.ts`** — Tool names, descriptions, input/output schemas
4. **`src/resources/*.resource.ts`** — Resource URIs and descriptions
5. **`package.json`** — Name, version, scripts, dependencies
6. **`.env.example`** — Required environment variables
7. **`ci/`** — Dockerfile, docker-compose.yml if present

## Step 3: Generate README Sections

### Common Sections (all targets)

```markdown
# {Project Name}

{One-line description from @FrontMcp info}

## Features

- {Tool 1 name} — {description}
- {Tool 2 name} — {description}
- {Resource 1} — {description}

## Quick Start

{Target-specific install + run instructions}

## Tools

| Tool     | Description   | Input                    |
| -------- | ------------- | ------------------------ |
| `{name}` | {description} | `{input schema summary}` |

## Resources

| URI                 | Description   |
| ------------------- | ------------- |
| `{uri or template}` | {description} |

## Environment Variables

| Variable | Required | Description   |
| -------- | -------- | ------------- |
| `{VAR}`  | {yes/no} | {description} |

## Development

{How to run locally, test, inspect}

## License

{License from package.json}
```

### Target-Specific Sections

**npm package (direct client):**

```markdown
## Installation

npm install {package-name}

## Usage

import { create } from '{package-name}';

const server = await create({
// configuration
});
const client = await server.connect();
const tools = await client.listTools();
```

**CLI binary:**

```markdown
## Installation

npm install -g {package-name}

## Usage

{package-name} --help
{package-name} [command] [options]

## Commands

| Command | Description   |
| ------- | ------------- |
| `{cmd}` | {description} |
```

**Docker / Node server:**

```markdown
## Docker

docker compose up

## Manual Deployment

docker build -f ci/Dockerfile -t {name}:latest .
docker run -p 3000:3000 {name}:latest
```

**Vercel:**

```markdown
## Deploy to Vercel

npm i -g vercel
frontmcp build --target vercel
vercel deploy --prebuilt

## Configuration

See `vercel.json` for route configuration and environment variables.
Set secrets via: `vercel env add REDIS_URL`
```

**AWS Lambda:**

```markdown
## Deploy to AWS Lambda

frontmcp build --target lambda
cd dist && sam build && sam deploy --guided

## Configuration

- SAM template: `template.yaml` defines the Lambda function, API Gateway, and DynamoDB table
- Environment variables: Set via `sam deploy` parameters or AWS Console
- API Gateway: Streamable HTTP endpoint at `https://{api-id}.execute-api.{region}.amazonaws.com/mcp`
```

**Cloudflare Workers:**

```markdown
## Deploy to Cloudflare Workers

frontmcp build --target cloudflare
npx wrangler deploy

## Configuration

- Workers config: `wrangler.toml` defines the worker name, routes, and KV bindings
- Secrets: `npx wrangler secret put REDIS_URL`
- KV namespace: Create via `npx wrangler kv:namespace create SESSION_STORE`
```

## Step 4: Update Existing README

When updating (not creating), preserve:

- Custom sections the user added manually
- Badges, logos, and branding
- Contributing guidelines, code of conduct links

Only update:

- Tool/resource tables (regenerate from source)
- Quick start instructions (if deployment target changed)
- Environment variables (if .env.example changed)

## Verification Checklist

- [ ] README includes all tools with descriptions from source code
- [ ] README includes all resources and their URIs
- [ ] Installation instructions match the deployment target
- [ ] Environment variables match `.env.example`
- [ ] Development section includes `frontmcp dev`, `frontmcp test`, `frontmcp inspect`
- [ ] License matches `package.json`

## Reference

- Related skills: `frontmcp-deployment` (for target-specific deployment details)
- Related skills: `frontmcp-setup` (for project structure)
