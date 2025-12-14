import * as path from 'path';
import { mkdtempSync, rmSync } from 'fs';
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
    jest.spyOn(process, 'chdir').mockImplementation(() => {});

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
      jest.spyOn(process, 'chdir').mockImplementation(() => {});
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
