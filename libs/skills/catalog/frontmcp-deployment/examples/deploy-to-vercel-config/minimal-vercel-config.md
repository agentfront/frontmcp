---
name: minimal-vercel-config
reference: deploy-to-vercel-config
level: basic
description: 'The minimal `vercel.json` written by `frontmcp build --target vercel`.'
tags: [deployment, vercel, serverless, config, minimal]
features:
  - 'Showing the exact `vercel.json` the CLI emits — version, buildCommand, installCommand'
  - 'Detecting the package manager from your lockfile (bun > pnpm > yarn > npm)'
  - 'No `rewrites` block: the Build Output API v3 handles routing via `.vercel/output/config.json`'
---

# Minimal vercel.json (auto-generated)

`frontmcp build --target vercel` writes this minimal `vercel.json` for you. The package manager is detected from your lockfile.

## Code

```json
// vercel.json — yarn project (yarn.lock present)
{
  "version": 2,
  "buildCommand": "yarn build",
  "installCommand": "yarn install"
}
```

```json
// vercel.json — pnpm project (pnpm-lock.yaml present)
{
  "version": 2,
  "buildCommand": "pnpm run build",
  "installCommand": "pnpm install"
}
```

```json
// vercel.json — npm project (package-lock.json present)
{
  "version": 2,
  "buildCommand": "npm run build",
  "installCommand": "npm install"
}
```

The actual function and routes live under `.vercel/output/`:

```text
.vercel/output/
├── config.json                            # routes /(.*) -> /index function
└── functions/
    └── index.func/
        ├── .vc-config.json                # nodejs24.x, handler: handler.cjs
        ├── handler.cjs                    # bundled handler
        ├── package.json                   # peer-dep manifest
        └── node_modules/                  # peer deps installed by the adapter
```

## What This Demonstrates

- The exact shape of the auto-generated `vercel.json` — three keys, nothing else
- That routing and function configuration live in `.vercel/output/`, not `vercel.json`
- That hand-authoring `api/frontmcp.ts` references in `vercel.json` is unnecessary and breaks deploys

## Related

- See `deploy-to-vercel-config` for headers/regions you may safely add on top
- See `deploy-to-vercel` for the full deployment workflow
