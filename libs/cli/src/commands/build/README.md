# Build Command

The `frontmcp build` command compiles your FrontMCP server for different deployment targets.

## Usage

```bash
# Build for Node.js (default)
frontmcp build

# Build for Vercel
frontmcp build --adapter vercel

# Build for AWS Lambda
frontmcp build --adapter lambda

# Build for Cloudflare Workers
frontmcp build --adapter cloudflare
```

## Adapters

Each adapter configures:
- **Module format**: CommonJS or ESM
- **Entry template**: Wrapper code for the deployment platform
- **Config file**: Platform-specific configuration (optional)

### Node.js (`node`)

Default adapter for running on Node.js directly.

| Property | Value |
|----------|-------|
| Module Format | `commonjs` |
| Entry Template | None (runs main.js directly) |
| Config File | None |

### Vercel (`vercel`)

Serverless deployment on Vercel.

| Property | Value |
|----------|-------|
| Module Format | `esnext` (ESM) |
| Entry Template | Handler with `export default` |
| Config File | `vercel.json` |

**Output:**
```
dist/
  main.js      # Compiled server
  index.js     # Vercel handler
vercel.json    # Vercel config
```

### AWS Lambda (`lambda`)

Serverless deployment on AWS Lambda.

| Property | Value |
|----------|-------|
| Module Format | `esnext` (ESM) |
| Entry Template | Handler using `@codegenie/serverless-express` |
| Config File | None (user manages SAM/Serverless/CDK) |

**Prerequisites:**
```bash
npm install @codegenie/serverless-express
```

**Output:**
```
dist/
  main.js      # Compiled server
  index.js     # Lambda handler
```

### Cloudflare Workers (`cloudflare`)

Edge deployment on Cloudflare Workers.

| Property | Value |
|----------|-------|
| Module Format | `commonjs` |
| Entry Template | Handler with `fetch` API adapter |
| Config File | `wrangler.toml` |

**Output:**
```
dist/
  main.js      # Compiled server
  index.js     # Cloudflare handler
wrangler.toml  # Wrangler config
```

## Architecture

```
build/
├── index.ts           # Main build logic (runBuild)
├── types.ts           # AdapterTemplate type definition
├── adapters/
│   ├── index.ts       # Adapter registry
│   ├── node.ts        # Node.js adapter
│   ├── vercel.ts      # Vercel adapter
│   ├── lambda.ts      # AWS Lambda adapter
│   └── cloudflare.ts  # Cloudflare Workers adapter
└── README.md          # This file
```

## Adding a New Adapter

1. Create a new file in `adapters/` (e.g., `adapters/netlify.ts`):

```typescript
import { AdapterTemplate } from '../types';

export const netlifyAdapter: AdapterTemplate = {
  moduleFormat: 'esnext',

  getEntryTemplate: (mainModulePath) => `
process.env.FRONTMCP_SERVERLESS = '1';
import '${mainModulePath}';
import { getServerlessHandlerAsync } from '@frontmcp/sdk';
// ... Netlify-specific handler code
`,

  getConfig: () => ({
    // netlify.toml content as object
  }),

  configFileName: 'netlify.toml',
};
```

2. Export from `adapters/index.ts`:

```typescript
import { netlifyAdapter } from './netlify';

export const ADAPTERS: Record<AdapterName, AdapterTemplate> = {
  // ...existing adapters
  netlify: netlifyAdapter,
};
```

3. Add to `AdapterName` type in `types.ts`:

```typescript
export type AdapterName = 'node' | 'vercel' | 'lambda' | 'cloudflare' | 'netlify';
```

4. Add to `DeploymentAdapter` type in `args.ts`:

```typescript
export type DeploymentAdapter = 'node' | 'vercel' | 'lambda' | 'cloudflare' | 'netlify';
```

## How It Works

1. **TypeScript Compilation**: The build command runs `tsc` with the adapter's module format (`--module commonjs` or `--module esnext`)

2. **Entry Generation**: For serverless adapters, an `index.js` wrapper is generated that:
   - Sets `FRONTMCP_SERVERLESS=1` environment variable
   - Imports the compiled main module (which runs the `@FrontMcp` decorator)
   - Exports a handler using `getServerlessHandlerAsync()` from the SDK

3. **Config Generation**: Platform-specific config files are generated in the project root

The `@FrontMcp` decorator automatically detects serverless mode via the `FRONTMCP_SERVERLESS` environment variable and stores the Express handler globally instead of calling `listen()`.
