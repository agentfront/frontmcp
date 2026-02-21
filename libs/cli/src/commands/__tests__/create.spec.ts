import * as path from 'path';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { runCreate } from '../create';

// Capture console output during tests
let consoleLogs: string[] = [];

describe('runCreate', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    consoleLogs = [];
    jest.spyOn(console, 'log').mockImplementation((...args) => {
      consoleLogs.push(args.join(' '));
    });
    jest.spyOn(console, 'error').mockImplementation((...args) => {
      consoleLogs.push(args.join(' '));
    });

    // Create temp directory for testing
    tempDir = mkdtempSync(path.join(tmpdir(), 'cli-test-'));
    originalCwd = process.cwd();

    // Mock process.chdir to track directory changes
    jest.spyOn(process, 'chdir').mockImplementation(() => {
      // No-op for testing
    });

    // Mock process.exit
    jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    // Set stdin.isTTY to false for non-interactive mode
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.chdir(originalCwd);

    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('non-interactive mode (--yes flag)', () => {
    beforeEach(() => {
      // Override process.cwd to return temp directory
      jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
    });

    it('should use default project name when not provided in non-interactive mode', async () => {
      // When no project name is provided, it defaults to 'frontmcp-app'
      await runCreate(undefined, { yes: true });

      expect(consoleLogs.some((log) => log.includes('frontmcp-app'))).toBe(true);
    });

    it('should use default options when --yes flag is set', async () => {
      await runCreate('test-project', { yes: true });

      // Check that project was created
      expect(consoleLogs.some((log) => log.includes('test-project'))).toBe(true);
      expect(consoleLogs.some((log) => log.includes('Deployment: node'))).toBe(true);
      expect(consoleLogs.some((log) => log.includes('Redis: docker'))).toBe(true);
      expect(consoleLogs.some((log) => log.includes('GitHub Actions: Yes'))).toBe(true);
    });

    it('should override deployment target with --target flag', async () => {
      await runCreate('vercel-project', { yes: true, target: 'vercel' });

      expect(consoleLogs.some((log) => log.includes('Deployment: vercel'))).toBe(true);
    });

    it('should override Redis setup with --redis flag', async () => {
      await runCreate('no-redis-project', { yes: true, redis: 'none' });

      expect(consoleLogs.some((log) => log.includes('Redis: none'))).toBe(true);
    });

    it('should disable GitHub Actions with --no-cicd flag', async () => {
      await runCreate('no-cicd-project', { yes: true, cicd: false });

      expect(consoleLogs.some((log) => log.includes('GitHub Actions: No'))).toBe(true);
    });

    it('should create Docker target files', async () => {
      await runCreate('docker-project', { yes: true, target: 'node' });

      // Verify Docker-specific logs
      expect(consoleLogs.some((log) => log.includes('ci/Dockerfile') || log.includes('Dockerfile'))).toBe(true);
      expect(
        consoleLogs.some((log) => log.includes('ci/docker-compose.yml') || log.includes('docker-compose.yml')),
      ).toBe(true);
    });

    it('should create Vercel target files', async () => {
      await runCreate('vercel-project', { yes: true, target: 'vercel' });

      // Verify Vercel-specific logs
      expect(consoleLogs.some((log) => log.includes('vercel.json'))).toBe(true);
    });

    it('should create Lambda target files', async () => {
      await runCreate('lambda-project', { yes: true, target: 'lambda' });

      // Verify Lambda-specific logs
      expect(consoleLogs.some((log) => log.includes('template.yaml'))).toBe(true);
    });

    it('should create Cloudflare target files', async () => {
      await runCreate('cloudflare-project', { yes: true, target: 'cloudflare' });

      // Verify Cloudflare-specific logs
      expect(consoleLogs.some((log) => log.includes('wrangler.toml'))).toBe(true);
    });
  });

  describe('file scaffolding', () => {
    beforeEach(() => {
      jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
    });

    it('should create src directory with main.ts', async () => {
      await runCreate('my-app', { yes: true });

      expect(consoleLogs.some((log) => log.includes('src/main.ts'))).toBe(true);
    });

    it('should create e2e directory with test file', async () => {
      await runCreate('my-app', { yes: true });

      expect(consoleLogs.some((log) => log.includes('e2e/server.e2e.test.ts'))).toBe(true);
    });

    it('should create tsconfig.e2e.json for E2E test typing', async () => {
      await runCreate('my-app', { yes: true });

      expect(consoleLogs.some((log) => log.includes('tsconfig.e2e.json'))).toBe(true);
    });

    it('should create package.json', async () => {
      await runCreate('my-app', { yes: true });

      expect(consoleLogs.some((log) => log.includes('package.json'))).toBe(true);
    });

    it('should create .gitignore', async () => {
      await runCreate('my-app', { yes: true });

      expect(consoleLogs.some((log) => log.includes('.gitignore'))).toBe(true);
    });

    it('should create README.md', async () => {
      await runCreate('my-app', { yes: true });

      expect(consoleLogs.some((log) => log.includes('README.md'))).toBe(true);
    });

    it('should use parent-relative paths in ci/docker-compose.yml for node target', async () => {
      await runCreate('docker-paths-app', { yes: true, target: 'node' });

      const composePath = path.join(tempDir, 'docker-paths-app', 'ci', 'docker-compose.yml');
      const content = readFileSync(composePath, 'utf8');

      expect(content).toContain('context: ..');
      expect(content).not.toMatch(/context:\s*\.(\s|$)/);
    });
  });

  describe('GitHub Actions', () => {
    beforeEach(() => {
      jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
    });

    it('should create GitHub Actions workflows when enabled', async () => {
      await runCreate('my-app', { yes: true, cicd: true });

      expect(consoleLogs.some((log) => log.includes('ci.yml'))).toBe(true);
      expect(consoleLogs.some((log) => log.includes('e2e.yml'))).toBe(true);
      expect(consoleLogs.some((log) => log.includes('deploy.yml'))).toBe(true);
    });

    it('should skip GitHub Actions workflows when disabled', async () => {
      await runCreate('my-app', { yes: true, cicd: false });

      // These files should NOT be created
      const ciYmlLog = consoleLogs.find(
        (log) => log.includes('ci.yml') && (log.includes('created') || log.includes('✓')),
      );
      expect(ciYmlLog).toBeUndefined();
    });
  });

  describe('Docker file scaffolding (target: node)', () => {
    beforeEach(() => {
      jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
    });

    describe('ci/Dockerfile', () => {
      it('should scaffold a multi-stage Dockerfile for Docker builds', async () => {
        await runCreate('docker-app', { yes: true, target: 'node' });

        const content = readFileSync(path.join(tempDir, 'docker-app', 'ci', 'Dockerfile'), 'utf8');

        // Multi-stage build
        expect(content).toContain('AS builder');
        expect(content).toContain('AS runner');

        // Base image
        expect(content).toContain('FROM node:24-alpine AS builder');
        expect(content).toContain('FROM node:24-alpine AS runner');

        // Builder stage
        expect(content).toContain('RUN npm ci');
        expect(content).toContain('COPY . .');
        expect(content).toContain('RUN npm run build');

        // Runner stage
        expect(content).toContain('ENV NODE_ENV=production');
        expect(content).toContain('COPY --from=builder /app/node_modules ./node_modules');
        expect(content).toContain('COPY --from=builder /app/dist ./dist');
        expect(content).toContain('COPY --from=builder /app/package.json ./');

        // Builder prunes devDeps before copy
        expect(content).toContain('npm prune --omit=dev');

        // Entrypoint
        expect(content).toContain('EXPOSE 3000');
        expect(content).toContain('CMD ["node", "dist/main.js"]');
      });
    });

    describe('ci/docker-compose.yml with redis: docker', () => {
      it('should configure Redis service with healthcheck and app with correct paths', async () => {
        await runCreate('compose-redis-app', { yes: true, target: 'node', redis: 'docker' });

        const content = readFileSync(path.join(tempDir, 'compose-redis-app', 'ci', 'docker-compose.yml'), 'utf8');

        // Redis service
        expect(content).toContain('image: redis:7-alpine');
        expect(content).toContain("'6379:6379'");
        expect(content).toContain('redis-data:/data');
        expect(content).toContain('redis-cli');

        // App service
        expect(content).toContain('context: ..');
        expect(content).toContain('dockerfile: ci/Dockerfile');
        expect(content).toContain('${PORT:-3000}:3000');

        // No source mounting or dev command override in production-oriented compose
        expect(content).not.toContain('../src:/app/src');
        expect(content).not.toMatch(/command:.*run\s+dev/);

        // No deprecated version field
        expect(content).not.toMatch(/^version:/m);

        // Dependencies
        expect(content).toContain('condition: service_healthy');

        // Environment
        expect(content).toContain('PORT=${PORT:-3000}');
        expect(content).toContain('REDIS_HOST=redis');
        expect(content).toContain('REDIS_PORT=6379');
      });
    });

    describe('ci/docker-compose.yml without Redis', () => {
      it('should have only app service when redis is none', async () => {
        await runCreate('compose-no-redis', { yes: true, target: 'node', redis: 'none' });

        const content = readFileSync(path.join(tempDir, 'compose-no-redis', 'ci', 'docker-compose.yml'), 'utf8');

        expect(content).toContain('app:');
        expect(content).toContain('context: ..');
        expect(content).toContain('dockerfile: ci/Dockerfile');
        expect(content).not.toContain('../src:/app/src');
        expect(content).not.toMatch(/command:.*run\s+dev/);

        expect(content).not.toContain('image: redis');
        expect(content).not.toContain('depends_on:');
        expect(content).not.toContain('REDIS_HOST');
        expect(content).not.toMatch(/^\s+redis:\s*$/m);
      });

      it('should use no-Redis compose template when redis is existing', async () => {
        await runCreate('compose-existing-redis', { yes: true, target: 'node', redis: 'existing' });

        const content = readFileSync(path.join(tempDir, 'compose-existing-redis', 'ci', 'docker-compose.yml'), 'utf8');

        expect(content).toContain('app:');
        expect(content).toContain('context: ..');
        expect(content).toContain('dockerfile: ci/Dockerfile');

        expect(content).not.toContain('image: redis');
        expect(content).not.toContain('depends_on:');
        expect(content).not.toContain('REDIS_HOST');
      });
    });

    describe('ci/.env.docker', () => {
      it('should contain Docker-specific environment variables', async () => {
        await runCreate('env-docker-app', { yes: true, target: 'node' });

        const content = readFileSync(path.join(tempDir, 'env-docker-app', 'ci', '.env.docker'), 'utf8');

        expect(content).toContain('REDIS_HOST=redis');
        expect(content).toContain('PORT=3000');
        expect(content).toContain('NODE_ENV=development');
        expect(content).toContain('REDIS_PORT=6379');
      });
    });

    describe('deploy.yml and package.json docker scripts', () => {
      it('should generate Docker deploy workflow for node target with cicd enabled', async () => {
        await runCreate('deploy-docker-app', { yes: true, target: 'node', cicd: true });

        const content = readFileSync(
          path.join(tempDir, 'deploy-docker-app', '.github', 'workflows', 'deploy.yml'),
          'utf8',
        );

        expect(content).toContain('ghcr.io');
        expect(content).toContain('docker/build-push-action');
        expect(content).toContain('file: ./ci/Dockerfile');
      });

      it('should include docker:up/down/build scripts in package.json', async () => {
        await runCreate('docker-scripts-app', { yes: true, target: 'node' });

        const pkgJson = JSON.parse(readFileSync(path.join(tempDir, 'docker-scripts-app', 'package.json'), 'utf8'));

        expect(pkgJson.scripts['docker:up']).toBe('docker compose -f ci/docker-compose.yml up');
        expect(pkgJson.scripts['docker:down']).toBe('docker compose -f ci/docker-compose.yml down');
        expect(pkgJson.scripts['docker:build']).toBe('docker compose -f ci/docker-compose.yml build');
      });
    });

    describe('Docker files excluded for non-node targets', () => {
      it('should not create Docker files for vercel target', async () => {
        await runCreate('vercel-no-docker', { yes: true, target: 'vercel' });

        const base = path.join(tempDir, 'vercel-no-docker');
        expect(existsSync(path.join(base, 'ci', 'Dockerfile'))).toBe(false);
        expect(existsSync(path.join(base, 'ci', 'docker-compose.yml'))).toBe(false);
        expect(existsSync(path.join(base, 'ci', '.env.docker'))).toBe(false);
      });

      it('should not create Docker files for lambda target', async () => {
        await runCreate('lambda-no-docker', { yes: true, target: 'lambda' });

        const base = path.join(tempDir, 'lambda-no-docker');
        expect(existsSync(path.join(base, 'ci', 'Dockerfile'))).toBe(false);
        expect(existsSync(path.join(base, 'ci', 'docker-compose.yml'))).toBe(false);
        expect(existsSync(path.join(base, 'ci', '.env.docker'))).toBe(false);
      });

      it('should not create Docker files for cloudflare target', async () => {
        await runCreate('cloudflare-no-docker', { yes: true, target: 'cloudflare' });

        const base = path.join(tempDir, 'cloudflare-no-docker');
        expect(existsSync(path.join(base, 'ci', 'Dockerfile'))).toBe(false);
        expect(existsSync(path.join(base, 'ci', 'docker-compose.yml'))).toBe(false);
        expect(existsSync(path.join(base, 'ci', '.env.docker'))).toBe(false);
      });

      it('should not include docker scripts in package.json for non-node targets', async () => {
        await runCreate('vercel-no-scripts', { yes: true, target: 'vercel' });

        const pkgJson = JSON.parse(readFileSync(path.join(tempDir, 'vercel-no-scripts', 'package.json'), 'utf8'));

        expect(pkgJson.scripts['docker:up']).toBeUndefined();
        expect(pkgJson.scripts['docker:down']).toBeUndefined();
        expect(pkgJson.scripts['docker:build']).toBeUndefined();
      });
    });
  });

  describe('package manager support', () => {
    beforeEach(() => {
      jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
    });

    it('should default to npm package manager', async () => {
      await runCreate('default-pm-app', { yes: true, target: 'node' });

      expect(consoleLogs.some((log) => log.includes('Package manager: npm'))).toBe(true);
    });

    describe('Dockerfile per package manager', () => {
      it('should generate npm Dockerfile with npm ci', async () => {
        await runCreate('npm-docker', { yes: true, target: 'node', pm: 'npm' });

        const content = readFileSync(path.join(tempDir, 'npm-docker', 'ci', 'Dockerfile'), 'utf8');
        expect(content).toContain('RUN npm ci');
        expect(content).toContain('COPY package*.json package-lock.json* ./');
        expect(content).toContain('RUN npm run build');
        expect(content).not.toContain('corepack');
      });

      it('should generate yarn Dockerfile with yarn install --frozen-lockfile', async () => {
        await runCreate('yarn-docker', { yes: true, target: 'node', pm: 'yarn' });

        const content = readFileSync(path.join(tempDir, 'yarn-docker', 'ci', 'Dockerfile'), 'utf8');
        expect(content).toContain('RUN yarn install --frozen-lockfile');
        expect(content).toContain('COPY package.json yarn.lock* ./');
        expect(content).toContain('RUN yarn build');
        expect(content).toContain('RUN corepack enable');
      });

      it('should generate pnpm Dockerfile with corepack enable and pnpm install', async () => {
        await runCreate('pnpm-docker', { yes: true, target: 'node', pm: 'pnpm' });

        const content = readFileSync(path.join(tempDir, 'pnpm-docker', 'ci', 'Dockerfile'), 'utf8');
        expect(content).toContain('RUN corepack enable');
        expect(content).toContain('RUN pnpm install --frozen-lockfile');
        expect(content).toContain('COPY package.json pnpm-lock.yaml* ./');
        expect(content).toContain('RUN pnpm run build');
      });
    });

    describe('GitHub Actions per package manager', () => {
      it('should generate CI workflow with yarn cache', async () => {
        await runCreate('yarn-ci', { yes: true, target: 'node', pm: 'yarn', cicd: true });

        const content = readFileSync(path.join(tempDir, 'yarn-ci', '.github', 'workflows', 'ci.yml'), 'utf8');
        expect(content).toContain("cache: 'yarn'");
        expect(content).toContain('yarn install --frozen-lockfile');
        expect(content).toContain("node-version: '24'");
      });

      it('should generate CI workflow with pnpm setup action', async () => {
        await runCreate('pnpm-ci', { yes: true, target: 'node', pm: 'pnpm', cicd: true });

        const content = readFileSync(path.join(tempDir, 'pnpm-ci', '.github', 'workflows', 'ci.yml'), 'utf8');
        expect(content).toContain('pnpm/action-setup@v4');
        expect(content).toContain("cache: 'pnpm'");
        expect(content).toContain('pnpm install --frozen-lockfile');
      });

      it('should generate CI workflow with npm cache', async () => {
        await runCreate('npm-ci', { yes: true, target: 'node', pm: 'npm', cicd: true });

        const content = readFileSync(path.join(tempDir, 'npm-ci', '.github', 'workflows', 'ci.yml'), 'utf8');
        expect(content).toContain("cache: 'npm'");
        expect(content).toContain('npm ci');
        expect(content).toContain("node-version: '24'");
      });
    });

    describe('package.json engines per package manager', () => {
      it('should set node>=24 and npm>=10 for npm', async () => {
        await runCreate('npm-engines', { yes: true, pm: 'npm' });

        const pkgJson = JSON.parse(readFileSync(path.join(tempDir, 'npm-engines', 'package.json'), 'utf8'));
        expect(pkgJson.engines.node).toBe('>=24');
        expect(pkgJson.engines.npm).toBe('>=10');
      });

      it('should set only node>=24 for yarn (no npm engine)', async () => {
        await runCreate('yarn-engines', { yes: true, pm: 'yarn' });

        const pkgJson = JSON.parse(readFileSync(path.join(tempDir, 'yarn-engines', 'package.json'), 'utf8'));
        expect(pkgJson.engines.node).toBe('>=24');
        expect(pkgJson.engines.npm).toBeUndefined();
      });

      it('should set only node>=24 for pnpm (no npm engine)', async () => {
        await runCreate('pnpm-engines', { yes: true, pm: 'pnpm' });

        const pkgJson = JSON.parse(readFileSync(path.join(tempDir, 'pnpm-engines', 'package.json'), 'utf8'));
        expect(pkgJson.engines.node).toBe('>=24');
        expect(pkgJson.engines.npm).toBeUndefined();
      });
    });
  });

  describe('project name sanitization', () => {
    beforeEach(() => {
      jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
    });

    it('should sanitize project name for folder', async () => {
      await runCreate('My Project Name', { yes: true });

      // Should be converted to lowercase with dashes
      expect(consoleLogs.some((log) => log.includes('my-project-name'))).toBe(true);
    });

    it('should handle scoped npm package names', async () => {
      await runCreate('@myorg/my-package', { yes: true });

      // Folder should be just the package name (without scope)
      expect(consoleLogs.some((log) => log.includes('my-package'))).toBe(true);
    });
  });
});

describe('helper functions', () => {
  // These tests import and test the internal helper functions
  // Since they're not exported, we test them indirectly through runCreate

  describe('sanitizeForFolder', () => {
    beforeEach(() => {
      const tempDir = mkdtempSync(path.join(tmpdir(), 'cli-test-'));
      jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
      jest.spyOn(process, 'chdir').mockImplementation(() => {
        // No-op for testing
      });
      jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`);
      }) as () => never);
      Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should convert uppercase to lowercase', async () => {
      const logs: string[] = [];
      jest.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await runCreate('MyProject', { yes: true });

      expect(logs.some((log) => log.includes('myproject'))).toBe(true);
    });

    it('should replace special characters with dashes', async () => {
      const logs: string[] = [];
      jest.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await runCreate('my@project!name', { yes: true });

      expect(logs.some((log) => log.includes('my-project-name'))).toBe(true);
    });
  });
});
