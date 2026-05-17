import { cliExtensionConfigSchema, frontmcpConfigSchema, RESERVED_VERBS } from '../frontmcp-config.schema';

describe('cliExtensionConfigSchema', () => {
  describe('valid configs', () => {
    it('accepts a single command with no args/options', () => {
      const result = cliExtensionConfigSchema.safeParse({
        commands: {
          deploy: { entry: './scripts/deploy.ts' },
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts a fully-specified command', () => {
      const result = cliExtensionConfigSchema.safeParse({
        commands: {
          'db-migrate': {
            entry: './scripts/db-migrate.ts',
            description: 'Run pending database migrations',
            arguments: [
              { name: 'env', required: true, description: 'Target environment' },
              { name: 'pattern', required: false, variadic: true },
            ],
            options: [
              { flags: '-n, --dry-run', description: 'Skip writes' },
              { flags: '-c, --concurrency <num>', default: 4 },
              { flags: '--keep-backup', default: true },
            ],
            hidden: false,
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts a colon-namespaced verb name', () => {
      const result = cliExtensionConfigSchema.safeParse({
        commands: { 'project:init': { entry: './scripts/init.ts' } },
      });
      expect(result.success).toBe(true);
    });

    it('accepts an empty commands map', () => {
      const result = cliExtensionConfigSchema.safeParse({ commands: {} });
      expect(result.success).toBe(true);
    });

    it('accepts cli block omitted entirely', () => {
      const result = cliExtensionConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('reserved-verb collisions', () => {
    it.each([...RESERVED_VERBS].slice(0, 8))('rejects "%s" (built-in verb)', (verb) => {
      const result = cliExtensionConfigSchema.safeParse({
        commands: { [verb]: { entry: './scripts/x.ts' } },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => /collides with a built-in/.test(i.message))).toBe(true);
      }
    });

    it('rejects "dev" specifically with a helpful collision message', () => {
      const result = cliExtensionConfigSchema.safeParse({
        commands: { dev: { entry: './scripts/dev.ts' } },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const collisionIssue = result.error.issues.find((i) => /collides with a built-in/.test(i.message));
        expect(collisionIssue).toBeDefined();
        expect(collisionIssue!.message).toMatch(/dev/);
        expect(collisionIssue!.message).toMatch(/project:/);
      }
    });
  });

  describe('invalid names', () => {
    it.each([['1leading-digit'], ['has space'], ['has/slash'], ['has.dot'], ['UPPER_then_$']])(
      'rejects "%s" (invalid name pattern)',
      (name) => {
        const result = cliExtensionConfigSchema.safeParse({
          commands: { [name]: { entry: './x.ts' } },
        });
        expect(result.success).toBe(false);
      },
    );
  });

  describe('variadic position', () => {
    it('accepts variadic on the last argument', () => {
      const result = cliExtensionConfigSchema.safeParse({
        commands: {
          deploy: {
            entry: './x.ts',
            arguments: [
              { name: 'env', required: true },
              { name: 'paths', variadic: true },
            ],
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects variadic in a non-trailing position', () => {
      const result = cliExtensionConfigSchema.safeParse({
        commands: {
          deploy: {
            entry: './x.ts',
            arguments: [
              { name: 'paths', variadic: true },
              { name: 'env', required: true },
            ],
          },
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => /variadic.*must be last/i.test(i.message))).toBe(true);
      }
    });
  });

  describe('strict shape', () => {
    it('rejects unknown top-level keys', () => {
      const result = cliExtensionConfigSchema.safeParse({
        commands: { deploy: { entry: './x.ts' } },
        // @ts-expect-error - testing strict rejection
        extra: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects unknown keys inside a command entry', () => {
      const result = cliExtensionConfigSchema.safeParse({
        commands: {
          deploy: {
            entry: './x.ts',
            // @ts-expect-error - testing strict rejection
            unknownKey: 'oops',
          },
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty entry string', () => {
      const result = cliExtensionConfigSchema.safeParse({
        commands: { deploy: { entry: '' } },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('integration with frontmcpConfigSchema', () => {
    it('accepts cli block alongside deployments', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [{ target: 'node' }],
        cli: {
          commands: {
            deploy: { entry: './scripts/deploy.ts', description: 'Ship it' },
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it('still validates cli reserved-verb collisions when nested in root config', () => {
      const result = frontmcpConfigSchema.safeParse({
        name: 'my-server',
        deployments: [{ target: 'node' }],
        cli: { commands: { dev: { entry: './x.ts' } } },
      });
      expect(result.success).toBe(false);
    });
  });
});
