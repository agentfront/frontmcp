---
name: vercel-deployment-readme
reference: readme-guide
level: intermediate
description: 'Generate a README for a FrontMCP server deployed to Vercel with Vercel KV storage.'
tags: [setup, vercel-kv, vercel, readme, deployment]
features:
  - 'Vercel-specific deployment instructions with `frontmcp build --target vercel` and `vercel deploy`'
  - 'Vercel KV environment variables (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) noted as auto-injected'
  - '`vercel.json` configuration reference for route setup'
  - 'Consistent README structure adapted to the Vercel deployment target'
---

# Vercel Deployment README

Generate a README for a FrontMCP server deployed to Vercel with Vercel KV storage.

## Code

```markdown
# My Vercel MCP Server

A serverless FrontMCP MCP server running on Vercel with Vercel KV for session storage.

## Features

- `lookup_user` -- Look up a user by email
- `create_ticket` -- Create a support ticket
- `tickets://open` -- List of open support tickets

## Quick Start

### Deploy to Vercel

npm i -g vercel
frontmcp build --target vercel
vercel deploy --prebuilt

### Local Development

npm install
npm run dev

## Tools

| Tool            | Description             | Input                             |
| --------------- | ----------------------- | --------------------------------- |
| `lookup_user`   | Look up a user by email | `{ email: string }`               |
| `create_ticket` | Create a support ticket | `{ title: string, body: string }` |

## Resources

| URI              | Description          |
| ---------------- | -------------------- |
| `tickets://open` | Open support tickets |

## Configuration

See `vercel.json` for route configuration and environment variables.

Set secrets via: `vercel env add REDIS_URL`

## Environment Variables

| Variable            | Required | Description                              |
| ------------------- | -------- | ---------------------------------------- |
| `KV_REST_API_URL`   | Yes      | Vercel KV REST API URL (auto-injected)   |
| `KV_REST_API_TOKEN` | Yes      | Vercel KV REST API token (auto-injected) |

## Development

frontmcp dev # Start dev server
frontmcp build --target vercel # Build for Vercel
vercel deploy --prebuilt # Deploy to Vercel

## License

MIT
```

## What This Demonstrates

- Vercel-specific deployment instructions with `frontmcp build --target vercel` and `vercel deploy`
- Vercel KV environment variables (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) noted as auto-injected
- `vercel.json` configuration reference for route setup
- Consistent README structure adapted to the Vercel deployment target

## Related

- See `readme-guide` for all deployment target README templates and update guidelines
