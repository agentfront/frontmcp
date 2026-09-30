---
name: minimal-vercel-config
reference: deploy-to-vercel-config
level: basic
description: '`frontmcp build --target vercel` writes this minimal `vercel.json` for you. The package manager is detected from your lockfile.'
tags:
  - deployment
  - vercel
  - serverless
  - config
  - minimal
features:
  - The exact shape of the auto-generated `vercel.json` — three keys, nothing else
  - That `buildCommand` builds the vercel target (`<exec> frontmcp build --target vercel`), not the `build` script
  - That routing and function configuration live in `.vercel/output/`, not `vercel.json`
  - That hand-authoring `api/frontmcp.ts` references in `vercel.json` is unnecessary and breaks deploys
---

# Minimal vercel.json (auto-generated)

`frontmcp build --target vercel` writes this minimal `vercel.json` for you. The package manager is detected from your lockfile.

## Code

```json
// vercel.json — yarn project (yarn.lock present)
{
  "version": 2,
  "buildCommand": "yarn frontmcp build --target vercel",
  "installCommand": "yarn install"
}
```

```json
// vercel.json — pnpm project (pnpm-lock.yaml present)
{
  "version": 2,
  "buildCommand": "pnpm exec frontmcp build --target vercel",
  "installCommand": "pnpm install"
}
```

```json
// vercel.json — npm project (package-lock.json present)
{
  "version": 2,
  "buildCommand": "npx frontmcp build --target vercel",
  "installCommand": "npm install"
}
```

`buildCommand` runs the vercel target through the project's package manager (bun projects get `bunx frontmcp build --target vercel`). It is never `<pm> run build`: the `build` script is `frontmcp build`, which builds the config's deployments and never writes `.vercel/output`.

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
- That `buildCommand` builds the vercel target (`<exec> frontmcp build --target vercel`), not the `build` script
- That routing and function configuration live in `.vercel/output/`, not `vercel.json`
- That hand-authoring `api/frontmcp.ts` references in `vercel.json` is unnecessary and breaks deploys

## Related

- See `deploy-to-vercel-config` for headers/regions you may safely add on top
- See `deploy-to-vercel` for the full deployment workflow
