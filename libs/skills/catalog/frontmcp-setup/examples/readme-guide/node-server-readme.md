---
name: node-server-readme
reference: readme-guide
level: basic
description: 'Generate a README for a FrontMCP server deployed as a Docker/Node.js service with tools and resources.'
tags: [setup, docker, readme, node]
features:
  - 'Standard README sections: Features, Quick Start, Tools table, Resources table, Environment Variables'
  - 'Docker-specific deployment section with build and run commands'
  - 'Development commands using `frontmcp dev`, `frontmcp test`, `frontmcp inspect`'
  - 'Tool and resource tables generated from source code decorators'
---

# Node.js Server README

Generate a README for a FrontMCP server deployed as a Docker/Node.js service with tools and resources.

## Code

```markdown
# My MCP Server

A FrontMCP-based MCP server providing calculator and weather tools.

## Features

- `add` -- Add two numbers together
- `fetch_weather` -- Fetch current weather for a city
- `config://app` -- Application configuration resource

## Quick Start

### Docker

docker compose up

### Manual

npm install
npm run dev

## Tools

| Tool            | Description           | Input                      |
| --------------- | --------------------- | -------------------------- |
| `add`           | Add two numbers       | `{ a: number, b: number }` |
| `fetch_weather` | Fetch current weather | `{ city: string }`         |

## Resources

| URI            | Description               |
| -------------- | ------------------------- |
| `config://app` | Application configuration |

## Environment Variables

| Variable     | Required | Description                     |
| ------------ | -------- | ------------------------------- |
| `PORT`       | No       | HTTP port (default: 3000)       |
| `REDIS_HOST` | No       | Redis host (default: localhost) |
| `REDIS_PORT` | No       | Redis port (default: 6379)      |
| `LOG_LEVEL`  | No       | Log level (default: info)       |

## Development

frontmcp dev # Start dev server with hot reload
frontmcp test # Run tests
frontmcp inspect # Inspect MCP server capabilities

## Docker Deployment

docker build -f ci/Dockerfile -t my-server:latest .
docker run -p 3000:3000 my-server:latest

## License

MIT
```

## What This Demonstrates

- Standard README sections: Features, Quick Start, Tools table, Resources table, Environment Variables
- Docker-specific deployment section with build and run commands
- Development commands using `frontmcp dev`, `frontmcp test`, `frontmcp inspect`
- Tool and resource tables generated from source code decorators

## Related

- See `readme-guide` for target-specific sections (Vercel, Lambda, Cloudflare, CLI, npm package)
