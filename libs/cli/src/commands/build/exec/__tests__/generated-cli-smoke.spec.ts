/**
 * Smoke tests for the generated CLI entry source.
 * Validates that generateCliEntry() produces valid, well-structured JavaScript.
 */

import { generateCliEntry, CliEntryOptions } from '../cli-runtime/generate-cli-entry';
import { ExtractedSchema } from '../cli-runtime/schema-extractor';

function makeSchema(overrides?: Partial<ExtractedSchema>): ExtractedSchema {
  return {
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    ...overrides,
  };
}

/**
 * Strip the shebang line (#!/usr/bin/env node) which is invalid in new Function().
 */
function stripShebang(source: string): string {
  return source.replace(/^#![^\n]*\n/, '');
}

function makeOptions(overrides?: Partial<CliEntryOptions>): CliEntryOptions {
  return {
    appName: 'test-app',
    appVersion: '1.0.0',
    description: 'Test application',
    serverBundleFilename: 'test-app.bundle.js',
    outputDefault: 'text',
    authRequired: false,
    excludeTools: [],
    nativeDeps: {},
    schema: makeSchema(),
    ...overrides,
  };
}

describe('generated CLI smoke tests', () => {
  describe('JavaScript validity', () => {
    it('should produce valid JavaScript with no tools', () => {
      const source = generateCliEntry(makeOptions());
      expect(() => new Function(stripShebang(source))).not.toThrow();
    });

    it('should produce valid JavaScript with multiple tools', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'search_users',
              description: 'Search for users',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search query' },
                  limit: { type: 'integer', description: 'Max results' },
                  verbose: { type: 'boolean', description: 'Verbose output' },
                },
                required: ['query'],
              },
            },
            {
              name: 'create_item',
              description: 'Create an item',
              inputSchema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  config: { type: 'object' },
                },
              },
            },
          ],
        }),
      }));

      expect(() => new Function(stripShebang(source))).not.toThrow();
    });

    it('should produce valid JavaScript with prompts', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          prompts: [
            {
              name: 'code_review',
              description: 'Review code',
              arguments: [
                { name: 'code', description: 'The code', required: true },
                { name: 'language', description: 'Language' },
              ],
            },
            {
              name: 'summarize',
              description: 'Summarize text',
              arguments: [{ name: 'text', required: true }],
            },
          ],
        }),
      }));

      expect(() => new Function(stripShebang(source))).not.toThrow();
    });

    it('should produce valid JavaScript with native deps configured', () => {
      const source = generateCliEntry(makeOptions({
        nativeDeps: {
          brew: ['redis', 'postgresql'],
          apt: ['libssl-dev'],
          npm: ['sharp'],
        },
      }));

      expect(() => new Function(stripShebang(source))).not.toThrow();
    });

    it('should produce valid JavaScript with all features combined', () => {
      const source = generateCliEntry(makeOptions({
        appName: 'full-app',
        appVersion: '3.2.1',
        description: 'Full featured app',
        outputDefault: 'json',
        nativeDeps: { brew: ['redis'] },
        schema: makeSchema({
          tools: [
            {
              name: 'list_items',
              description: "List all items with filtering",
              inputSchema: {
                type: 'object',
                properties: {
                  filter: { type: 'string' },
                  format: { type: 'string', enum: ['json', 'csv', 'text'] },
                  page: { type: 'integer', default: 1 },
                },
              },
            },
          ],
          resources: [
            { uri: 'file://config.json', name: 'Config', description: 'Config' },
          ],
          prompts: [
            {
              name: 'explain',
              description: 'Explain something',
              arguments: [{ name: 'topic', required: true }],
            },
          ],
        }),
      }));

      expect(() => new Function(stripShebang(source))).not.toThrow();
    });
  });

  describe('commander command structure', () => {
    it('should contain .command() for each tool as kebab-case', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'search_users',
              description: 'Search users',
              inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
            },
            {
              name: 'getUserDetails',
              description: 'Get user details',
              inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
            },
          ],
        }),
      }));

      expect(source).toContain('.command("search-users")');
      expect(source).toContain('.command("get-user-details")');
    });

    it('should use original tool names in callTool()', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'search_users',
              description: 'Search users',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'getUserDetails',
              description: 'Get user',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      }));

      expect(source).toContain('callTool("search_users"');
      expect(source).toContain('callTool("getUserDetails"');
    });

    it('should generate .option() for each parameter', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'test_tool',
              description: 'Test',
              inputSchema: {
                type: 'object',
                properties: {
                  userName: { type: 'string', description: 'User name' },
                  maxResults: { type: 'integer', description: 'Max results' },
                  includeArchived: { type: 'boolean', description: 'Include archived' },
                },
                required: ['userName'],
              },
            },
          ],
        }),
      }));

      expect(source).toContain("'--user-name <value>'");
      expect(source).toContain("'--max-results <number>'");
      expect(source).toContain("'--include-archived'");
    });

    it('should include .requiredOption() for required parameters', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'test',
              description: 'Test',
              inputSchema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
                required: ['name'],
              },
            },
          ],
        }),
      }));

      expect(source).toContain('.requiredOption(');
    });

    it('should include .action(async function handler)', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'ping',
              description: 'Ping',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      }));

      expect(source).toContain('.action(async function');
    });

    it('should end with program.parseAsync(process.argv)', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain('program.parseAsync(process.argv)');
    });
  });

  describe('required module references', () => {
    it('should require commander', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("require('commander')");
    });

    it('should require output-formatter module', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("require('./output-formatter')");
    });

    it('should require session-manager module', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("require('./session-manager')");
    });

    it('should require credential-store module', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("require('./credential-store')");
    });

    it('should reference the server bundle filename', () => {
      const source = generateCliEntry(makeOptions({
        serverBundleFilename: 'my-server.bundle.js',
      }));
      expect(source).toContain('my-server.bundle.js');
    });
  });

  describe('comprehensive multi-tool schema', () => {
    const fullSchema = makeSchema({
      tools: [
        {
          name: 'create_user',
          description: 'Create a new user',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Full name' },
              email: { type: 'string', description: 'Email address' },
              age: { type: 'integer', description: 'User age' },
              role: { type: 'string', enum: ['admin', 'user', 'moderator'] },
              active: { type: 'boolean', description: 'Is active' },
            },
            required: ['name', 'email'],
          },
        },
        {
          name: 'deleteUser',
          description: 'Delete a user',
          inputSchema: {
            type: 'object',
            properties: {
              userId: { type: 'string', description: 'User ID' },
              force: { type: 'boolean', description: 'Force delete' },
            },
            required: ['userId'],
          },
        },
        {
          name: 'list_items_by_category',
          description: 'List items filtered by category',
          inputSchema: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              limit: { type: 'integer', default: 10 },
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      ],
      resources: [
        { uri: 'file://db.sqlite', name: 'Database', description: 'Main database' },
      ],
      prompts: [
        {
          name: 'summarize',
          description: 'Summarize content',
          arguments: [
            { name: 'content', description: 'Content to summarize', required: true },
            { name: 'maxLength', description: 'Maximum length' },
          ],
        },
      ],
    });

    it('should produce valid JavaScript with comprehensive schema', () => {
      const source = generateCliEntry(makeOptions({ schema: fullSchema }));
      expect(() => new Function(stripShebang(source))).not.toThrow();
    });

    it('should have subcommands for all tools', () => {
      const source = generateCliEntry(makeOptions({ schema: fullSchema }));
      expect(source).toContain('"create-user"');
      expect(source).toContain('"delete-user"');
      expect(source).toContain('"list-items-by-category"');
    });

    it('should preserve original names in callTool', () => {
      const source = generateCliEntry(makeOptions({ schema: fullSchema }));
      expect(source).toContain('callTool("create_user"');
      expect(source).toContain('callTool("deleteUser"');
      expect(source).toContain('callTool("list_items_by_category"');
    });

    it('should generate enum choices for role parameter', () => {
      const source = generateCliEntry(makeOptions({ schema: fullSchema }));
      expect(source).toContain('.choices(["admin","user","moderator"])');
    });

    it('should generate variadic flag for array parameters', () => {
      const source = generateCliEntry(makeOptions({ schema: fullSchema }));
      expect(source).toContain("'--tags <items...>'");
    });

    it('should include parseInt coercion for integer fields', () => {
      const source = generateCliEntry(makeOptions({ schema: fullSchema }));
      expect(source).toContain('parseInt(v, 10)');
    });
  });
});
