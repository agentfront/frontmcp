---
name: multi-api-hub-with-inline-spec
reference: official-adapters
level: advanced
description: 'Demonstrates registering multiple OpenAPI adapters from different APIs in a single app, including one with an inline spec definition instead of a remote URL.'
tags: [development, openapi, remote, adapters, multi, api]
features:
  - 'Registering multiple adapters in a single `@App` with unique names for tool namespacing'
  - 'Using `additionalHeaders` for header-based authentication (GitHub token)'
  - 'Providing an inline `spec` object instead of a remote `url` for APIs without hosted specs'
  - "Each adapter's tools are namespaced: `github:*`, `jira:*`, `internal:*`"
  - 'Only one of `url` or `spec` should be provided per adapter; `spec` takes precedence'
---

# Multi-API Hub with Inline Spec

Demonstrates registering multiple OpenAPI adapters from different APIs in a single app, including one with an inline spec definition instead of a remote URL.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';

@App({
  name: 'integration-hub',
  adapters: [
    // Remote specs from public APIs
    OpenapiAdapter.init({
      name: 'github',
      url: 'https://api.github.com/openapi.json',
      additionalHeaders: {
        Authorization: `token ${process.env.GITHUB_TOKEN!}`,
      },
    }),

    OpenapiAdapter.init({
      name: 'jira',
      url: 'https://jira.example.com/openapi.json',
      staticAuth: {
        apiKey: process.env.JIRA_API_KEY!,
      },
    }),

    // Inline spec for an internal API without a hosted spec URL
    OpenapiAdapter.init({
      name: 'internal',
      spec: {
        openapi: '3.0.0',
        info: { title: 'Internal API', version: '1.0.0' },
        paths: {
          '/health': {
            get: {
              operationId: 'getHealth',
              summary: 'Health check endpoint',
              responses: {
                '200': {
                  description: 'Service is healthy',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          status: { type: 'string' },
                          uptime: { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '/users/{id}': {
            get: {
              operationId: 'getUserById',
              summary: 'Get user by ID',
              parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
              responses: {
                '200': {
                  description: 'User found',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          email: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      baseUrl: 'https://internal.example.com',
      staticAuth: {
        jwt: process.env.INTERNAL_API_TOKEN!,
      },
    }),
  ],
})
class IntegrationHub {}
// Tools: github:createIssue, jira:createTicket, internal:getHealth, internal:getUserById

@FrontMcp({
  info: { name: 'multi-api-server', version: '1.0.0' },
  apps: [IntegrationHub],
  http: { port: 3000 },
})
class MyServer {}
```

## What This Demonstrates

- Registering multiple adapters in a single `@App` with unique names for tool namespacing
- Using `additionalHeaders` for header-based authentication (GitHub token)
- Providing an inline `spec` object instead of a remote `url` for APIs without hosted specs
- Each adapter's tools are namespaced: `github:*`, `jira:*`, `internal:*`
- Only one of `url` or `spec` should be provided per adapter; `spec` takes precedence

## Related

- See `official-adapters` for spec polling, `securityResolver`, and the adapter vs plugin comparison
- See `decorators-guide` for the `@Adapter` decorator and how adapters fit in the hierarchy
