---
name: json-schema-ide-support
reference: configure-deployment-targets
level: basic
description: Use frontmcp.config.json with JSON Schema for VS Code and WebStorm autocomplete
tags: [config, deployment, json, schema, ide, autocomplete]
features:
  - Adding $schema field for IDE autocomplete in JSON config files
  - Configuring multiple deployment targets in JSON format
  - Using the frontmcp.schema.json for property validation and hover docs
---

# JSON Config with IDE Autocomplete

When using `frontmcp.config.json` instead of TypeScript, add the `$schema` field to get property autocomplete, validation, and hover documentation in VS Code and WebStorm.

## Code

```json
{
  "$schema": "./node_modules/@frontmcp/cli/frontmcp.schema.json",
  "name": "my-server",
  "version": "1.0.0",
  "deployments": [
    {
      "target": "node",
      "server": {
        "http": { "port": 3000 },
        "headers": {
          "hsts": "max-age=31536000",
          "contentTypeOptions": "nosniff",
          "frameOptions": "DENY"
        }
      }
    },
    {
      "target": "distributed",
      "ha": {
        "heartbeatIntervalMs": 10000,
        "heartbeatTtlMs": 30000
      }
    }
  ]
}
```

### Verify

```bash
# Build all targets defined in config (no -t flag needed)
frontmcp build
# [build] Building 2 target(s) from frontmcp.config: node, distributed
```

## What This Demonstrates

- The `$schema` field provides autocomplete for all config properties in JSON editors
- Property validation catches typos and wrong types before build
- The schema supports all 8 deployment targets and their nested options
- Running `frontmcp build` without `-t` builds all targets defined in the config

## Related

- See `configure-deployment-targets` for the full configuration reference
- See `multi-target-with-security` for the TypeScript `defineConfig()` approach
