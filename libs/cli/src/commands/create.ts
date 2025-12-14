import * as path from 'path';
import { promises as fsp } from 'fs';
import { c } from '../colors';
import { ensureDir, fileExists, isDirEmpty, writeJSON } from '../utils/fs';
import { runInit } from '../tsconfig';
import { getSelfVersion } from '../version';
import { readJSON } from '../utils/fs';

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

async function upsertPackageJson(cwd: string, nameOverride: string | undefined, selfVersion: string) {
  const pkgPath = path.join(cwd, 'package.json');
  const existing = await readJSON<Record<string, any>>(pkgPath);

  const frontmcpLibRange = `~${selfVersion}`;

  const base = {
    name: nameOverride ?? pkgNameFromCwd(cwd),
    version: '0.1.0',
    private: true,
    type: 'commonjs',
    main: 'src/main.ts',
    scripts: {
      dev: 'frontmcp dev',
      build: 'frontmcp build',
      inspect: 'frontmcp inspector',
      doctor: 'frontmcp doctor',
      test: 'frontmcp test',
      'test:e2e': 'jest --config jest.e2e.config.ts --runInBand',
    },
    engines: {
      node: '>=22',
      npm: '>=10',
    },
    dependencies: {
      '@frontmcp/sdk': frontmcpLibRange,
      '@frontmcp/plugins': frontmcpLibRange,
      '@frontmcp/adapters': frontmcpLibRange,
      zod: '^4.0.0',
      'reflect-metadata': '^0.2.2',
    },
    devDependencies: {
      frontmcp: selfVersion,
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

  const merged: any = { ...base, ...existing };

  merged.name = existing.name || base.name;
  merged.main = existing.main || base.main;
  merged.type = existing.type || base.type;

  merged.scripts = {
    ...base.scripts,
    ...(existing.scripts || {}),
    dev: existing.scripts?.dev ?? base.scripts.dev,
    build: existing.scripts?.build ?? base.scripts.build,
    inspect: existing.scripts?.inspect ?? base.scripts.inspect,
    doctor: existing.scripts?.doctor ?? base.scripts.doctor,
    test: existing.scripts?.test ?? base.scripts.test,
    'test:e2e': existing.scripts?.['test:e2e'] ?? base.scripts['test:e2e'],
  };

  merged.engines = {
    ...(existing.engines || {}),
    node: existing.engines?.node || base.engines.node,
    npm: existing.engines?.npm || base.engines.npm,
  };

  merged.dependencies = {
    ...(existing.dependencies || {}),
    ...base.dependencies,
    '@frontmcp/sdk': frontmcpLibRange,
    '@frontmcp/plugins': frontmcpLibRange,
    '@frontmcp/adapters': frontmcpLibRange,
    zod: '^4.0.0',
    'reflect-metadata': '^0.2.2',
  };

  merged.devDependencies = {
    ...(existing.devDependencies || {}),
    ...base.devDependencies,
    frontmcp: selfVersion,
    tsx: '^4.20.6',
    typescript: '^5.5.3',
  };

  await writeJSON(pkgPath, merged);
  console.log(c('green', '✅ Updated package.json (synced @frontmcp libs + frontmcp to current CLI version)'));
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

const TEMPLATE_DOCKER_COMPOSE = `
version: '3.8'

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
      interval: 10s
      timeout: 5s
      retries: 3

  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - '\${PORT:-3000}:3000'
    environment:
      - NODE_ENV=\${NODE_ENV:-development}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      redis:
        condition: service_healthy
    volumes:
      - ./src:/app/src
    command: npm run dev

volumes:
  redis-data:
`;

const TEMPLATE_DOCKERFILE = `
# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
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
└── tsconfig.json      # TypeScript config
\`\`\`

## Learn More

- [FrontMCP Documentation](https://docs.agentfront.dev)
- [MCP Specification](https://modelcontextprotocol.io)
`;

export async function runCreate(projectArg?: string): Promise<void> {
  if (!projectArg) {
    console.error(c('red', 'Error: project name is required.\n'));
    console.log(`Usage: ${c('bold', 'npx frontmcp create <project-name>')}`);
    process.exit(1);
  }

  const folder = sanitizeForFolder(projectArg);
  const pkgName = sanitizeForNpm(projectArg);
  const targetDir = path.resolve(process.cwd(), folder);

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
  } catch (e: any) {
    if (e?.code === 'ENOENT') {
      await ensureDir(targetDir);
    } else {
      throw e;
    }
  }

  console.log(
    `${c('cyan', '[create]')} Creating project in ${c('bold', './' + path.relative(process.cwd(), targetDir))}`,
  );
  process.chdir(targetDir);

  await runInit(targetDir);

  const selfVersion = getSelfVersion();
  await upsertPackageJson(targetDir, pkgName, selfVersion);

  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'main.ts'), TEMPLATE_MAIN_TS);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'calc.app.ts'), TEMPLATE_CALC_APP_TS);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'tools', 'add.tool.ts'), TEMPLATE_ADD_TOOL_TS);

  // E2E scaffolding
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'e2e', 'server.e2e.test.ts'), TEMPLATE_E2E_TEST_TS);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'jest.e2e.config.ts'), TEMPLATE_JEST_E2E_CONFIG);

  // Git configuration
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, '.gitignore'), TEMPLATE_GITIGNORE);

  // Docker & Redis setup
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'docker-compose.yml'), TEMPLATE_DOCKER_COMPOSE);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'Dockerfile'), TEMPLATE_DOCKERFILE);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, '.env.example'), TEMPLATE_ENV_EXAMPLE);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, '.env.docker'), TEMPLATE_ENV_DOCKER);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'README.md'), TEMPLATE_README);

  console.log('\nNext steps:');
  console.log(`  1) cd ${folder}`);
  console.log('  2) npm install');
  console.log('  3) npm run dev      ', c('gray', '# tsx watcher + async tsc type-check'));
  console.log('  4) npm run inspect  ', c('gray', '# launch MCP Inspector'));
  console.log('  5) npm run build    ', c('gray', '# compile with tsc via frontmcp build'));
  console.log('  6) npm run test:e2e ', c('gray', '# run E2E tests'));
  console.log('');
  console.log(c('cyan', 'Docker:'));
  console.log('  docker compose up redis -d  ', c('gray', '# start Redis for development'));
  console.log('  docker compose up           ', c('gray', '# start full stack'));
}
