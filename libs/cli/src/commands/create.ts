import * as path from 'path';
import { promises as fsp } from 'fs';
import { c } from '../colors';
import { ensureDir, fileExists, isDirEmpty, writeJSON, readJSON } from '@frontmcp/utils';
import { runInit } from '../tsconfig';
import { getSelfVersion } from '../version';
import { clack } from '../utils/prompts';

// =============================================================================
// Types
// =============================================================================

export type DeploymentTarget = 'node' | 'vercel' | 'lambda' | 'cloudflare';
export type RedisSetup = 'docker' | 'existing' | 'none';
export type PackageManager = 'npm' | 'yarn' | 'pnpm';

export interface CreateOptions {
  projectName: string;
  deploymentTarget: DeploymentTarget;
  redisSetup: RedisSetup;
  enableGitHubActions: boolean;
  packageManager: PackageManager;
}

export interface CreateFlags {
  yes?: boolean;
  target?: DeploymentTarget;
  redis?: RedisSetup;
  cicd?: boolean;
  pm?: PackageManager;
}

interface PmConfig {
  lockfileCopy: string;
  installAll: string;
  pruneDevDeps: string;
  run: string;
  userInstall: string;
  ghCache: string;
  ghInstallCmd: string;
  engines: { node: string; npm?: string };
}

const PM_CONFIG: Record<PackageManager, PmConfig> = {
  npm: {
    lockfileCopy: 'COPY package*.json package-lock.json* ./',
    installAll: 'RUN npm ci',
    pruneDevDeps: 'RUN npm prune --omit=dev',
    run: 'npm run',
    userInstall: 'npm install',
    ghCache: 'npm',
    ghInstallCmd: 'npm ci',
    engines: { node: '>=22', npm: '>=10' },
  },
  yarn: {
    lockfileCopy: 'COPY package.json yarn.lock* ./',
    installAll: 'RUN yarn install --frozen-lockfile',
    pruneDevDeps: 'RUN yarn install --frozen-lockfile --production',
    run: 'yarn',
    userInstall: 'yarn install',
    ghCache: 'yarn',
    ghInstallCmd: 'yarn install --frozen-lockfile',
    engines: { node: '>=22' },
  },
  pnpm: {
    lockfileCopy: 'COPY package.json pnpm-lock.yaml* ./',
    installAll: 'RUN pnpm install --frozen-lockfile',
    pruneDevDeps: 'RUN pnpm prune --prod',
    run: 'pnpm run',
    userInstall: 'pnpm install',
    ghCache: 'pnpm',
    ghInstallCmd: 'pnpm install --frozen-lockfile',
    engines: { node: '>=22' },
  },
};

interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  main?: string;
  scripts?: Record<string, string>;
  engines?: { node?: string; npm?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}

function sanitizeForFolder(name: string): string {
  const seg = name.startsWith('@') && name.includes('/') ? name.split('/')[1] : name;
  return (
    seg
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'frontmcp-app'
  );
}

function sanitizeForNpm(name: string): string {
  if (name.startsWith('@') && name.includes('/')) {
    const [scope, pkg] = name.split('/');
    const s = scope.replace(/[^a-z0-9-]/gi, '').toLowerCase();
    const p = pkg.replace(/[^a-z0-9._-]/gi, '-').toLowerCase();
    return `@${s}/${p || 'frontmcp-app'}`;
  }
  return name.replace(/[^a-z0-9._-]/gi, '-').toLowerCase() || 'frontmcp-app';
}

function pkgNameFromCwd(cwd: string) {
  return (
    path
      .basename(cwd)
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .toLowerCase() || 'frontmcp-app'
  );
}

async function scaffoldFileIfMissing(baseDir: string, p: string, content: string) {
  if (await fileExists(p)) {
    console.log(c('gray', `skip: ${path.relative(baseDir, p)} already exists`));
    return;
  }
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, content.replace(/^\n/, ''), 'utf8');
  console.log(c('green', `✓ created ${path.relative(baseDir, p)}`));
}

const TEMPLATE_MAIN_TS = `
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';
import { CalcApp } from './calc.app';

@FrontMcp({
  info: { name: 'Demo 🚀', version: '0.1.0' },
  apps: [CalcApp],
})
export default class Server {}
`;

const TEMPLATE_CALC_APP_TS = `
import { App } from '@frontmcp/sdk';
import AddTool from './tools/add.tool';

@App({
  id: 'calc',
  name: 'Calculator',
  tools: [AddTool],
})
export class CalcApp {}
`;

const TEMPLATE_ADD_TOOL_TS = `
import {Tool, ToolContext} from "@frontmcp/sdk";
import {z} from "zod";

@Tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: {a: z.number(), b: z.number()},
  outputSchema: {result: z.number()}
})
export default class AddTool extends ToolContext {
  async execute(input: { a: number, b: number }) {
    return {
      result: input.a + input.b,
    };
  }
}
`;

const TEMPLATE_E2E_TEST_TS = `
import { test, expect } from '@frontmcp/testing';

test.describe('Server E2E', () => {
  test.use({
    server: './src/main.ts',
    port: 3100,
  });

  test('should connect and initialize', async ({ mcp }) => {
    expect(mcp.isConnected()).toBe(true);
    expect(mcp.serverInfo.name).toBeDefined();
  });

  test('should list tools', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    expect(tools.length).toBeGreaterThanOrEqual(0);
  });

  test('should call add tool', async ({ mcp }) => {
    const result = await mcp.tools.call('add', { a: 2, b: 3 });
    expect(result).toBeSuccessful();
  });
});
`;

const TEMPLATE_GITIGNORE = `
# Dependencies
node_modules/

# Build output
dist/
*.tsbuildinfo

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.*.local

# FrontMCP development keys (contains private keys - never commit!)
.frontmcp/

# Coverage
coverage/

# Test output
test-output/
`;

const TEMPLATE_DOCKERIGNORE = `
node_modules
dist
.git
coverage
test-output
*.tsbuildinfo
.idea
.vscode
.DS_Store
Thumbs.db
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.env
.env.local
.env.*.local
.frontmcp
e2e
*.md
LICENSE
`;

const TEMPLATE_JEST_E2E_CONFIG = `
/* eslint-disable */
export default {
  displayName: 'e2e',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.e2e.test.ts'],
  testTimeout: 60000,
  setupFilesAfterEnv: ['@frontmcp/testing/setup'],
  transform: {
    '^.+\\\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2022',
          parser: {
            syntax: 'typescript',
            decorators: true,
            dynamicImport: true,
          },
          transform: {
            decoratorMetadata: true,
            legacyDecorator: true,
          },
          keepClassNames: true,
          externalHelpers: true,
          loose: true,
        },
        module: {
          type: 'es6',
        },
        sourceMaps: true,
        swcrc: false,
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
};
`;

const TEMPLATE_TSCONFIG_E2E = `
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["node", "jest"]
  },
  "include": ["e2e/**/*.ts", "jest.e2e.config.ts"]
}
`;

const TEMPLATE_ENV_EXAMPLE = `
# Application
PORT=3000
NODE_ENV=development

# Redis (recommended for development, required for production)
REDIS_HOST=localhost
REDIS_PORT=6379
# SECURITY: Set a strong password in production
REDIS_PASSWORD=
REDIS_DB=0

# Optional: Redis TLS (enable for production)
REDIS_TLS=false
`;

const TEMPLATE_ENV_DOCKER = `
# Docker-specific environment
# Copy this to .env when running with docker compose

# Application
PORT=3000
NODE_ENV=development

# Redis - use 'redis' (service name) as host inside Docker network
REDIS_HOST=redis
REDIS_PORT=6379
# SECURITY: Set a strong password in production
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
`;

const TEMPLATE_README = `
# FrontMCP Server

A TypeScript MCP server built with [FrontMCP](https://github.com/agentfront/frontmcp).

## Quick Start

\`\`\`bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run MCP Inspector
npm run inspect
\`\`\`

## Development with Docker

### Prerequisites
- Docker & Docker Compose installed

### Quick Start

\`\`\`bash
# Start Redis and app in development mode
docker compose up

# Start only Redis (for local development)
docker compose up redis -d

# Stop all services
docker compose down
\`\`\`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| \`PORT\` | 3000 | Application port |
| \`NODE_ENV\` | development | Environment mode |
| \`REDIS_HOST\` | localhost | Redis host (use \`redis\` in Docker) |
| \`REDIS_PORT\` | 6379 | Redis port |

## Redis Configuration

### Development
Redis is **recommended** for development to enable caching and session persistence.
Use the included \`docker-compose.yml\` to run Redis locally:

\`\`\`bash
docker compose up redis -d
\`\`\`

### Production
Redis is **required** in production for:
- Session storage (multi-instance deployments)
- Caching (performance optimization)
- Rate limiting (if enabled)

See the [Redis Setup Guide](https://docs.agentfront.dev/docs/deployment/redis-setup) for production configuration.

## Scripts

| Script | Description |
|--------|-------------|
| \`npm run dev\` | Start development server with hot reload |
| \`npm run build\` | Build for production |
| \`npm run inspect\` | Launch MCP Inspector |
| \`npm run doctor\` | Check project configuration |
| \`npm run test\` | Run unit tests |
| \`npm run test:e2e\` | Run E2E tests |

## Project Structure

\`\`\`
├── .env.example       # Environment variables template
├── .gitignore         # Git ignore rules
├── docker-compose.yml # Docker services config
├── Dockerfile         # Container build config
├── e2e/               # E2E tests
├── jest.e2e.config.ts # Jest E2E configuration
├── package.json       # Dependencies and scripts
├── src/
│   ├── main.ts        # Server entry point
│   ├── calc.app.ts    # Example app
│   └── tools/
│       └── add.tool.ts # Example tool
├── tsconfig.json      # TypeScript config
└── tsconfig.e2e.json  # TypeScript config for E2E tests
\`\`\`

## Learn More

- [FrontMCP Documentation](https://docs.agentfront.dev)
- [MCP Specification](https://modelcontextprotocol.io)
`;

// =============================================================================
// Deployment Target Templates
// =============================================================================

// Docker templates (moved to ci/ folder)
function generateDockerfile(pm: PackageManager): string {
  const cfg = PM_CONFIG[pm];
  const corepack = pm !== 'npm' ? '\nRUN corepack enable\n' : '';
  return `
# Build stage
FROM node:22-slim AS builder

WORKDIR /app
${corepack}
# Install all dependencies (including devDependencies for build)
${cfg.lockfileCopy}
${cfg.installAll}

# Copy source and build
COPY . .
RUN ${cfg.run} build

# Prune devDependencies so only production deps remain
${cfg.pruneDevDeps}

# Production stage
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

EXPOSE 3000

CMD ["node", "dist/main.js"]
`;
}

function generateDockerComposeWithRedis(): string {
  return `
services:
  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 3s
      timeout: 5s
      retries: 3

  app:
    build:
      context: ..
      dockerfile: ci/Dockerfile
    ports:
      - '\${PORT:-3000}:3000'
    environment:
      - NODE_ENV=\${NODE_ENV:-development}
      - PORT=\${PORT:-3000}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      redis:
        condition: service_healthy

volumes:
  redis-data:
`;
}

function generateDockerComposeNoRedis(): string {
  return `
services:
  app:
    build:
      context: ..
      dockerfile: ci/Dockerfile
    ports:
      - '\${PORT:-3000}:3000'
    environment:
      - NODE_ENV=\${NODE_ENV:-development}
      - PORT=\${PORT:-3000}
`;
}

const TEMPLATE_ENV_DOCKER_CI = `
# Docker-specific environment
# Use with: docker compose -f ci/docker-compose.yml --env-file ci/.env.docker up

# Application
PORT=3000
NODE_ENV=development

# Redis - use 'redis' (service name) as host inside Docker network
REDIS_HOST=redis
REDIS_PORT=6379
# SECURITY: Set a strong password in production
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
`;

// Vercel template
const TEMPLATE_VERCEL_JSON = (projectName: string) =>
  JSON.stringify(
    {
      $schema: 'https://openapi.vercel.sh/vercel.json',
      name: projectName,
      version: 2,
      builds: [
        {
          src: 'dist/main.js',
          use: '@vercel/node',
        },
      ],
      routes: [
        {
          src: '/(.*)',
          dest: '/dist/main.js',
        },
      ],
      env: {
        NODE_ENV: 'production',
      },
    },
    null,
    2,
  );

// AWS Lambda SAM template
const TEMPLATE_SAM_YAML = (projectName: string) => `
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: ${projectName} - FrontMCP Lambda Function

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs22.x
    MemorySize: 256

Resources:
  FrontMCPFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: ../dist/
      Handler: main.handler
      Events:
        ApiEvent:
          Type: HttpApi
          Properties:
            Path: /{proxy+}
            Method: ANY

Outputs:
  ApiEndpoint:
    Description: API Gateway endpoint URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com"
`;

// Cloudflare Workers template
const TEMPLATE_WRANGLER_TOML = (projectName: string) => `
name = "${projectName}"
main = "dist/main.js"
compatibility_date = "2024-01-01"

[vars]
NODE_ENV = "production"

# Uncomment to enable KV namespace for caching
# [[kv_namespaces]]
# binding = "CACHE"
# id = "your-kv-namespace-id"
`;

// =============================================================================
// GitHub Actions Templates
// =============================================================================

function generatePmSetupSteps(pm: PackageManager): string {
  const cfg = PM_CONFIG[pm];
  if (pm === 'pnpm') {
    return `
      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: '${cfg.ghCache}'

      - name: Install dependencies
        run: ${cfg.ghInstallCmd}`;
  }
  return `
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: '${cfg.ghCache}'

      - name: Install dependencies
        run: ${cfg.ghInstallCmd}`;
}

function generateGhCi(pm: PackageManager): string {
  const cfg = PM_CONFIG[pm];
  return `
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
${generatePmSetupSteps(pm)}

      - name: Type check
        run: npx tsc --noEmit

      - name: Run tests
        run: ${cfg.run} test
`;
}

function generateGhE2e(pm: PackageManager): string {
  const cfg = PM_CONFIG[pm];
  return `
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
${generatePmSetupSteps(pm)}

      - name: Build
        run: ${cfg.run} build

      - name: Run E2E tests
        run: ${cfg.run} test:e2e
`;
}

const TEMPLATE_GH_DEPLOY_DOCKER = `
name: Build and Push Docker Image

on:
  push:
    branches: [main]
    tags: ['v*']

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: \${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: \${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./ci/Dockerfile
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
`;

function generateGhDeployVercel(pm: PackageManager): string {
  const cfg = PM_CONFIG[pm];
  return `
name: Deploy to Vercel

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
${generatePmSetupSteps(pm)}

      - name: Build
        run: ${cfg.run} build

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: \${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: \${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: \${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
`;
}

function generateGhDeployLambda(pm: PackageManager): string {
  const cfg = PM_CONFIG[pm];
  return `
name: Deploy to AWS Lambda

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
${generatePmSetupSteps(pm)}

      - name: Build
        run: ${cfg.run} build

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: \${{ secrets.AWS_REGION }}

      - name: Setup SAM
        uses: aws-actions/setup-sam@v2

      - name: Deploy with SAM
        run: |
          cd ci
          sam build
          sam deploy --no-confirm-changeset --no-fail-on-empty-changeset
`;
}

function generateGhDeployCloudflare(pm: PackageManager): string {
  const cfg = PM_CONFIG[pm];
  return `
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
${generatePmSetupSteps(pm)}

      - name: Build
        run: ${cfg.run} build

      - name: Deploy to Cloudflare
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;
}

// =============================================================================
// Dynamic README Templates
// =============================================================================

function generateReadme(options: CreateOptions): string {
  const { projectName, deploymentTarget, redisSetup, enableGitHubActions, packageManager } = options;
  const cfg = PM_CONFIG[packageManager];

  let readme = `# ${projectName}

A TypeScript MCP server built with [FrontMCP](https://github.com/agentfront/frontmcp).
`;

  // Add CI badge if GitHub Actions enabled
  if (enableGitHubActions) {
    readme += `
![CI](https://github.com/YOUR_USERNAME/${projectName}/actions/workflows/ci.yml/badge.svg)
`;
  }

  readme += `
## Quick Start

\`\`\`bash
# Install dependencies
${cfg.userInstall}

# Start development server
${cfg.run} dev

# Run MCP Inspector
${cfg.run} inspect
\`\`\`
`;

  // Deployment-specific sections
  if (deploymentTarget === 'node') {
    readme += `
## Docker Development

\`\`\`bash
# Start all services${redisSetup === 'docker' ? ' (includes Redis)' : ''}
${cfg.run} docker:up

# Stop all services
${cfg.run} docker:down

# Rebuild Docker image
${cfg.run} docker:build
\`\`\`
`;

    if (redisSetup === 'docker') {
      readme += `
### Redis

Redis is included in the Docker Compose setup. For local development without Docker:

\`\`\`bash
# Start only Redis
docker compose -f ci/docker-compose.yml up redis -d
\`\`\`
`;
    }

    readme += `
## Production Deployment

Build and push the Docker image:

\`\`\`bash
docker build -f ci/Dockerfile -t ${projectName}:latest .
docker push your-registry/${projectName}:latest
\`\`\`
`;
  }

  if (deploymentTarget === 'vercel') {
    readme += `
## Deploy to Vercel

\`\`\`bash
# Build for production
${cfg.run} build

# Deploy using Vercel CLI
npx vercel --prod
\`\`\`

Or connect your repository to Vercel for automatic deployments.
`;
  }

  if (deploymentTarget === 'lambda') {
    readme += `
## Deploy to AWS Lambda

\`\`\`bash
# Build the project
${cfg.run} build

# Deploy using AWS SAM
${cfg.run} deploy
\`\`\`

### Prerequisites

- AWS CLI configured with appropriate credentials
- AWS SAM CLI installed (\`brew install aws-sam-cli\` or \`pip install aws-sam-cli\`)
`;
  }

  if (deploymentTarget === 'cloudflare') {
    readme += `
## Deploy to Cloudflare Workers

\`\`\`bash
# Build the project
${cfg.run} build

# Deploy using Wrangler
${cfg.run} deploy
\`\`\`

### Prerequisites

- Wrangler CLI installed (\`npm install -g wrangler\`)
- Cloudflare account configured (\`wrangler login\`)
`;
  }

  // Environment variables section
  readme += `
## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| \`PORT\` | 3000 | Application port |
| \`NODE_ENV\` | development | Environment mode |
`;

  if (deploymentTarget === 'node' && redisSetup !== 'none') {
    readme += `| \`REDIS_HOST\` | localhost | Redis host (use \`redis\` in Docker) |
| \`REDIS_PORT\` | 6379 | Redis port |
| \`REDIS_PASSWORD\` | - | Redis password (set in production) |
`;
  }

  // GitHub Actions section
  if (enableGitHubActions) {
    readme += `
## CI/CD

This project includes GitHub Actions workflows:

- **ci.yml**: Runs on every push/PR - type checking and tests
- **e2e.yml**: Runs E2E tests
- **deploy.yml**: Deploys to ${
      deploymentTarget === 'node'
        ? 'GitHub Container Registry'
        : deploymentTarget === 'vercel'
          ? 'Vercel'
          : deploymentTarget === 'lambda'
            ? 'AWS Lambda'
            : 'Cloudflare Workers'
    }

### Required Secrets
`;

    if (deploymentTarget === 'vercel') {
      readme += `
- \`VERCEL_TOKEN\`: Vercel API token
- \`VERCEL_ORG_ID\`: Vercel organization ID
- \`VERCEL_PROJECT_ID\`: Vercel project ID
`;
    } else if (deploymentTarget === 'lambda') {
      readme += `
- \`AWS_ACCESS_KEY_ID\`: AWS access key
- \`AWS_SECRET_ACCESS_KEY\`: AWS secret key
- \`AWS_REGION\`: AWS region (e.g., us-east-1)
`;
    } else if (deploymentTarget === 'cloudflare') {
      readme += `
- \`CLOUDFLARE_API_TOKEN\`: Cloudflare API token with Workers permissions
`;
    } else {
      readme += `
No additional secrets required - uses \`GITHUB_TOKEN\` for GHCR.
`;
    }
  }

  readme += `
## Scripts

| Script | Description |
|--------|-------------|
| \`${cfg.run} dev\` | Start development server with hot reload |
| \`${cfg.run} build\` | Build for production |
| \`${cfg.run} inspect\` | Launch MCP Inspector |
| \`${cfg.run} doctor\` | Check project configuration |
| \`${cfg.run} test\` | Run unit tests |
| \`${cfg.run} test:e2e\` | Run E2E tests |
`;

  if (deploymentTarget === 'node') {
    readme += `| \`${cfg.run} docker:up\` | Start Docker services |
| \`${cfg.run} docker:down\` | Stop Docker services |
| \`${cfg.run} docker:build\` | Rebuild Docker image |
`;
  }

  if (deploymentTarget === 'lambda' || deploymentTarget === 'cloudflare') {
    readme += `| \`${cfg.run} deploy\` | Deploy to ${deploymentTarget === 'lambda' ? 'AWS Lambda' : 'Cloudflare Workers'} |
`;
  }

  readme += `
## Project Structure

\`\`\`
`;

  // Dynamic project structure based on options
  readme += `├── .env.example       # Environment variables template
├── .gitignore         # Git ignore rules
`;

  if (deploymentTarget === 'node') {
    readme += `├── .dockerignore      # Docker build context exclusions
├── ci/
│   ├── Dockerfile         # Container build config
│   ├── docker-compose.yml # Docker services config
│   └── .env.docker        # Docker-specific env vars
`;
  }

  if (deploymentTarget === 'vercel') {
    readme += `├── vercel.json        # Vercel deployment config
`;
  }

  if (deploymentTarget === 'lambda') {
    readme += `├── ci/
│   └── template.yaml      # AWS SAM template
`;
  }

  if (deploymentTarget === 'cloudflare') {
    readme += `├── wrangler.toml      # Cloudflare Workers config
`;
  }

  if (enableGitHubActions) {
    readme += `├── .github/workflows/
│   ├── ci.yml             # CI workflow
│   ├── e2e.yml            # E2E test workflow
│   └── deploy.yml         # Deployment workflow
`;
  }

  readme += `├── e2e/               # E2E tests
├── jest.e2e.config.ts # Jest E2E configuration
├── package.json       # Dependencies and scripts
├── src/
│   ├── main.ts        # Server entry point
│   ├── calc.app.ts    # Example app
│   └── tools/
│       └── add.tool.ts # Example tool
├── tsconfig.json      # TypeScript config
└── tsconfig.e2e.json  # TypeScript config for E2E tests
\`\`\`

## Learn More

- [FrontMCP Documentation](https://docs.agentfront.dev)
- [MCP Specification](https://modelcontextprotocol.io)
`;

  return readme;
}

// =============================================================================
// Scaffolding Functions
// =============================================================================

function getDefaults(projectArg?: string): CreateOptions {
  return {
    projectName: projectArg || 'frontmcp-app',
    deploymentTarget: 'node',
    redisSetup: 'docker',
    enableGitHubActions: true,
    packageManager: 'npm',
  };
}

async function collectOptions(projectArg?: string, flags?: CreateFlags): Promise<CreateOptions> {
  const p = await clack();

  // Project name
  let projectName = projectArg;
  if (!projectName) {
    const result = await p.text({
      message: 'Project name',
      validate: (val) => {
        if (!val.trim()) return 'Project name is required';
        return undefined;
      },
    });
    if (p.isCancel(result)) {
      p.cancel('Cancelled.');
      process.exit(0);
    }
    projectName = result;
  }

  // Deployment target
  let deploymentTarget = flags?.target;
  if (!deploymentTarget) {
    const result = await p.select({
      message: 'Select deployment target',
      options: [
        { label: 'Node.js (Docker) - Recommended for production', value: 'node' as DeploymentTarget },
        { label: 'Vercel (Serverless)', value: 'vercel' as DeploymentTarget },
        { label: 'AWS Lambda', value: 'lambda' as DeploymentTarget },
        { label: 'Cloudflare Workers', value: 'cloudflare' as DeploymentTarget },
      ],
      initialValue: 'node' as DeploymentTarget,
    });
    if (p.isCancel(result)) {
      p.cancel('Cancelled.');
      process.exit(0);
    }
    deploymentTarget = result;
  }

  // Redis setup (only for Node.js/Docker)
  let redisSetup: RedisSetup = 'none';
  if (deploymentTarget === 'node') {
    if (flags?.redis) {
      redisSetup = flags.redis;
    } else {
      const result = await p.select({
        message: 'Redis setup',
        options: [
          { label: 'Docker Compose (recommended for development)', value: 'docker' as RedisSetup },
          { label: 'Existing Redis (I have my own Redis)', value: 'existing' as RedisSetup },
          { label: 'None (skip Redis)', value: 'none' as RedisSetup },
        ],
        initialValue: 'docker' as RedisSetup,
      });
      if (p.isCancel(result)) {
        p.cancel('Cancelled.');
        process.exit(0);
      }
      redisSetup = result;
    }
  }

  // Package manager
  let packageManager = flags?.pm;
  if (!packageManager) {
    const result = await p.select({
      message: 'Package manager',
      options: [
        { label: 'npm (default)', value: 'npm' as PackageManager },
        { label: 'yarn', value: 'yarn' as PackageManager },
        { label: 'pnpm', value: 'pnpm' as PackageManager },
      ],
      initialValue: 'npm' as PackageManager,
    });
    if (p.isCancel(result)) {
      p.cancel('Cancelled.');
      process.exit(0);
    }
    packageManager = result;
  }

  // GitHub Actions
  let enableGitHubActions = flags?.cicd;
  if (enableGitHubActions === undefined) {
    const result = await p.confirm({
      message: 'Set up GitHub Actions CI/CD?',
      initialValue: true,
    });
    if (p.isCancel(result)) {
      p.cancel('Cancelled.');
      process.exit(0);
    }
    enableGitHubActions = result;
  }

  return {
    projectName,
    deploymentTarget,
    redisSetup,
    enableGitHubActions,
    packageManager,
  };
}

async function scaffoldDeploymentFiles(targetDir: string, options: CreateOptions): Promise<void> {
  const { deploymentTarget, redisSetup, projectName } = options;

  switch (deploymentTarget) {
    case 'node': {
      const ciDir = path.join(targetDir, 'ci');
      await ensureDir(ciDir);
      await scaffoldFileIfMissing(
        targetDir,
        path.join(ciDir, 'Dockerfile'),
        generateDockerfile(options.packageManager),
      );

      const dockerCompose = redisSetup === 'docker' ? generateDockerComposeWithRedis() : generateDockerComposeNoRedis();
      await scaffoldFileIfMissing(targetDir, path.join(ciDir, 'docker-compose.yml'), dockerCompose);
      await scaffoldFileIfMissing(targetDir, path.join(ciDir, '.env.docker'), TEMPLATE_ENV_DOCKER_CI);
      await scaffoldFileIfMissing(targetDir, path.join(targetDir, '.dockerignore'), TEMPLATE_DOCKERIGNORE);
      break;
    }

    case 'vercel':
      await scaffoldFileIfMissing(
        targetDir,
        path.join(targetDir, 'vercel.json'),
        TEMPLATE_VERCEL_JSON(sanitizeForFolder(projectName)),
      );
      break;

    case 'lambda': {
      const ciDir = path.join(targetDir, 'ci');
      await ensureDir(ciDir);
      await scaffoldFileIfMissing(targetDir, path.join(ciDir, 'template.yaml'), TEMPLATE_SAM_YAML(projectName));
      break;
    }

    case 'cloudflare':
      await scaffoldFileIfMissing(
        targetDir,
        path.join(targetDir, 'wrangler.toml'),
        TEMPLATE_WRANGLER_TOML(sanitizeForFolder(projectName)),
      );
      break;
  }

  // Always create .env.example at root
  const envExample =
    deploymentTarget === 'node' && redisSetup !== 'none' ? TEMPLATE_ENV_EXAMPLE : TEMPLATE_ENV_EXAMPLE_BASIC;
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, '.env.example'), envExample);
}

// Basic .env.example without Redis
const TEMPLATE_ENV_EXAMPLE_BASIC = `
# Application
PORT=3000
NODE_ENV=development
`;

async function scaffoldGitHubActions(
  targetDir: string,
  deploymentTarget: DeploymentTarget,
  pm: PackageManager,
): Promise<void> {
  const workflowDir = path.join(targetDir, '.github', 'workflows');
  await ensureDir(workflowDir);

  // Always create CI and E2E workflows
  await scaffoldFileIfMissing(targetDir, path.join(workflowDir, 'ci.yml'), generateGhCi(pm));
  await scaffoldFileIfMissing(targetDir, path.join(workflowDir, 'e2e.yml'), generateGhE2e(pm));

  // Create deployment workflow based on target
  const deployTemplate = getDeployWorkflowTemplate(deploymentTarget, pm);
  await scaffoldFileIfMissing(targetDir, path.join(workflowDir, 'deploy.yml'), deployTemplate);
}

function getDeployWorkflowTemplate(target: DeploymentTarget, pm: PackageManager): string {
  switch (target) {
    case 'node':
      return TEMPLATE_GH_DEPLOY_DOCKER;
    case 'vercel':
      return generateGhDeployVercel(pm);
    case 'lambda':
      return generateGhDeployLambda(pm);
    case 'cloudflare':
      return generateGhDeployCloudflare(pm);
  }
}

async function scaffoldProject(options: CreateOptions): Promise<void> {
  const { projectName, deploymentTarget, redisSetup, enableGitHubActions, packageManager } = options;

  const folder = sanitizeForFolder(projectName);
  const pkgName = sanitizeForNpm(projectName);
  const targetDir = path.resolve(process.cwd(), folder);

  // Validate directory
  try {
    const stat = await fsp.stat(targetDir);
    if (!stat.isDirectory()) {
      console.error(
        c('red', `Refusing to scaffold into non-directory path: ${path.relative(process.cwd(), targetDir)}`),
      );
      console.log(c('gray', 'Pick a different project name or remove/rename the existing file.'));
      process.exit(1);
    }
    if (!(await isDirEmpty(targetDir))) {
      console.error(
        c('red', `Refusing to scaffold into non-empty directory: ${path.relative(process.cwd(), targetDir)}`),
      );
      console.log(c('gray', 'Pick a different name or start with an empty folder.'));
      process.exit(1);
    }
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
      await ensureDir(targetDir);
    } else {
      throw e;
    }
  }

  console.log(`\n${c('cyan', '[create]')} Creating project in ${c('bold', './' + folder)}`);
  console.log(c('gray', `  Deployment: ${deploymentTarget}`));
  if (deploymentTarget === 'node') {
    console.log(c('gray', `  Redis: ${redisSetup}`));
  }
  console.log(c('gray', `  Package manager: ${packageManager}`));
  console.log(c('gray', `  GitHub Actions: ${enableGitHubActions ? 'Yes' : 'No'}`));
  console.log('');

  process.chdir(targetDir);

  // Initialize tsconfig
  await runInit(targetDir);

  // Create package.json with deployment-specific scripts
  const selfVersion = getSelfVersion();
  await upsertPackageJsonWithTarget(targetDir, pkgName, selfVersion, deploymentTarget, packageManager);

  // Scaffold base files
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'main.ts'), TEMPLATE_MAIN_TS);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'calc.app.ts'), TEMPLATE_CALC_APP_TS);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'tools', 'add.tool.ts'), TEMPLATE_ADD_TOOL_TS);

  // E2E scaffolding
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'e2e', 'server.e2e.test.ts'), TEMPLATE_E2E_TEST_TS);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'jest.e2e.config.ts'), TEMPLATE_JEST_E2E_CONFIG);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'tsconfig.e2e.json'), TEMPLATE_TSCONFIG_E2E);

  // Git configuration
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, '.gitignore'), TEMPLATE_GITIGNORE);

  // Deployment-specific files
  await scaffoldDeploymentFiles(targetDir, options);

  // GitHub Actions
  if (enableGitHubActions) {
    await scaffoldGitHubActions(targetDir, deploymentTarget, packageManager);
  }

  // Dynamic README
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'README.md'), generateReadme(options));

  // Print next steps
  printNextSteps(folder, deploymentTarget, redisSetup, enableGitHubActions, packageManager);
}

function printNextSteps(
  folder: string,
  deploymentTarget: DeploymentTarget,
  redisSetup: RedisSetup,
  enableGitHubActions: boolean,
  pm: PackageManager,
): void {
  const cfg = PM_CONFIG[pm];
  console.log('\nNext steps:');
  console.log(`  1) cd ${folder}`);
  console.log(`  2) ${cfg.userInstall}`);
  console.log(`  3) ${cfg.run} dev      `, c('gray', '# tsx watcher + async tsc type-check'));
  console.log(`  4) ${cfg.run} inspect  `, c('gray', '# launch MCP Inspector'));
  console.log(`  5) ${cfg.run} build    `, c('gray', '# compile with tsc via frontmcp build'));
  console.log(`  6) ${cfg.run} test:e2e `, c('gray', '# run E2E tests'));

  if (deploymentTarget === 'node') {
    console.log('');
    console.log(c('cyan', 'Docker:'));
    console.log(
      `  ${cfg.run} docker:up   `,
      c('gray', `# start${redisSetup === 'docker' ? ' Redis +' : ''} app in Docker`),
    );
    console.log(`  ${cfg.run} docker:down `, c('gray', '# stop Docker services'));
  }

  if (deploymentTarget === 'vercel') {
    console.log('');
    console.log(c('cyan', 'Deploy to Vercel:'));
    console.log('  npx vercel          ', c('gray', '# deploy to Vercel'));
  }

  if (deploymentTarget === 'lambda') {
    console.log('');
    console.log(c('cyan', 'Deploy to AWS Lambda:'));
    console.log(`  ${cfg.run} deploy      `, c('gray', '# deploy with SAM'));
  }

  if (deploymentTarget === 'cloudflare') {
    console.log('');
    console.log(c('cyan', 'Deploy to Cloudflare:'));
    console.log(`  ${cfg.run} deploy      `, c('gray', '# deploy with Wrangler'));
  }

  if (enableGitHubActions) {
    console.log('');
    console.log(c('cyan', 'GitHub Actions:'));
    console.log('  .github/workflows/  ', c('gray', '# CI, E2E, and deploy workflows ready'));
  }
}

// =============================================================================
// Package.json with Target-Specific Scripts
// =============================================================================

async function upsertPackageJsonWithTarget(
  cwd: string,
  nameOverride: string | undefined,
  selfVersion: string,
  deploymentTarget: DeploymentTarget,
  pm: PackageManager = 'npm',
) {
  const pkgPath = path.join(cwd, 'package.json');
  const existing = await readJSON<PackageJson>(pkgPath);

  const frontmcpLibRange = `~${selfVersion}`;

  const baseScripts: Record<string, string> = {
    dev: 'frontmcp dev',
    build: 'frontmcp build',
    inspect: 'frontmcp inspector',
    doctor: 'frontmcp doctor',
    test: 'frontmcp test',
    'test:e2e': 'jest --config jest.e2e.config.ts --runInBand',
  };

  // Add target-specific scripts
  if (deploymentTarget === 'node') {
    baseScripts['docker:up'] = 'docker compose -f ci/docker-compose.yml up';
    baseScripts['docker:down'] = 'docker compose -f ci/docker-compose.yml down';
    baseScripts['docker:build'] = 'docker compose -f ci/docker-compose.yml build';
  }

  if (deploymentTarget === 'lambda') {
    baseScripts['deploy'] = 'cd ci && sam build && sam deploy';
  }

  if (deploymentTarget === 'cloudflare') {
    baseScripts['deploy'] = 'wrangler deploy';
  }

  const base = {
    name: nameOverride ?? pkgNameFromCwd(cwd),
    version: '0.1.0',
    private: true,
    type: 'commonjs',
    main: 'src/main.ts',
    scripts: baseScripts,
    engines: PM_CONFIG[pm].engines,
    dependencies: {
      '@frontmcp/sdk': frontmcpLibRange,
      '@frontmcp/plugins': frontmcpLibRange,
      '@frontmcp/adapters': frontmcpLibRange,
      frontmcp: selfVersion,
      tslib: '^2.5.0',
      zod: '^4.0.0',
      'reflect-metadata': '^0.2.2',
    },
    devDependencies: {
      '@frontmcp/testing': frontmcpLibRange,
      '@swc/core': '^1.11.29',
      '@swc/jest': '^0.2.37',
      jest: '^29.7.0',
      '@types/jest': '^29.5.14',
      tsx: '^4.20.6',
      '@types/node': '^24.0.0',
      typescript: '^5.5.3',
    },
  };

  if (!existing) {
    await writeJSON(pkgPath, base);
    console.log(c('green', '✅ Created package.json (synced @frontmcp libs to CLI version + exact frontmcp)'));
    return;
  }

  const merged: PackageJson = { ...base, ...existing };

  merged.name = existing.name || base.name;
  merged.main = existing.main || base.main;
  merged.type = existing.type || base.type;

  // Preserve user scripts, add base scripts only if missing
  merged.scripts = {
    ...baseScripts,
    ...(existing.scripts || {}),
  };

  merged.engines = {
    ...(existing.engines || {}),
    ...base.engines,
  };

  merged.dependencies = {
    ...(existing.dependencies || {}),
    ...base.dependencies,
  };

  merged.devDependencies = {
    ...(existing.devDependencies || {}),
    ...base.devDependencies,
  };

  await writeJSON(pkgPath, merged);
  console.log(c('green', '✅ Updated package.json (synced @frontmcp libs + frontmcp to current CLI version)'));
}

// =============================================================================
// Main Entry Point
// =============================================================================

export async function runCreate(projectArg?: string, flags?: CreateFlags): Promise<void> {
  // Non-interactive mode: use --yes flag or non-TTY environment
  if (flags?.yes || !isInteractive()) {
    const options = getDefaults(projectArg);
    // Override defaults with any provided flags
    if (flags?.target) options.deploymentTarget = flags.target;
    if (flags?.redis) options.redisSetup = flags.redis;
    if (flags?.cicd !== undefined) options.enableGitHubActions = flags.cicd;
    if (flags?.pm) options.packageManager = flags.pm;
    if (projectArg) options.projectName = projectArg;

    if (!options.projectName) {
      console.error(c('red', 'Error: project name is required in non-interactive mode.\n'));
      console.log(`Usage: ${c('bold', 'npx frontmcp create <project-name> --yes')}`);
      process.exit(1);
    }

    await scaffoldProject(options);
    return;
  }

  // Interactive mode
  const p = await clack();
  p.intro('Create a new FrontMCP project');

  const options = await collectOptions(projectArg, flags);
  await scaffoldProject(options);

  p.outro('Done!');
}
