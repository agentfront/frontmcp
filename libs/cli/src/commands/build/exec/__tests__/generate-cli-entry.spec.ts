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

describe('generateCliEntry', () => {
  it('should generate valid JavaScript with commander', () => {
    const source = generateCliEntry(makeOptions());
    expect(source).toContain("require('commander')");
    expect(source).toContain('.name(');
    expect(source).toContain('.version(');
    expect(source).toContain('parseAsync');
  });

  it('should include app name and version', () => {
    const source = generateCliEntry(makeOptions({
      appName: 'my-server',
      appVersion: '2.3.4',
    }));
    expect(source).toContain('"my-server"');
    expect(source).toContain('"2.3.4"');
  });

  it('should include global --output option', () => {
    const source = generateCliEntry(makeOptions());
    expect(source).toContain("'--output <mode>'");
  });

  describe('tool commands', () => {
    it('should generate subcommand for each tool', () => {
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
                },
                required: ['query'],
              },
            },
          ],
        }),
      }));

      expect(source).toContain('"search-users"');
      expect(source).toContain('"Search for users"');
      expect(source).toContain("'--query <value>'");
      expect(source).toContain("'--limit <number>'");
      expect(source).toContain('callTool("search_users"');
    });

    it('should convert tool names with underscores to kebab-case', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'get_user_details',
              description: 'Get user details',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      }));

      expect(source).toContain('"get-user-details"');
    });

    it('should exclude tools in excludeTools list', () => {
      const source = generateCliEntry(makeOptions({
        excludeTools: ['internal_tool'],
        schema: makeSchema({
          tools: [
            {
              name: 'public_tool',
              description: 'Public',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'internal_tool',
              description: 'Internal',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      }));

      expect(source).toContain('"public-tool"');
      expect(source).not.toContain('callTool("internal_tool"');
    });

    it('should handle tool with no properties', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [{
            name: 'ping',
            description: 'Ping the server',
            inputSchema: { type: 'object' },
          }],
        }),
      }));

      expect(source).toContain('"ping"');
      expect(source).toContain('"Ping the server"');
    });
  });

  describe('resource commands', () => {
    it('should include resource list and read commands', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("'resource'");
      expect(source).toContain("'list'");
      expect(source).toContain("'read <uri>'");
      expect(source).toContain('listResources');
      expect(source).toContain('readResource');
    });
  });

  describe('prompt commands', () => {
    it('should generate subcommand for each prompt', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          prompts: [
            {
              name: 'code_review',
              description: 'Review code',
              arguments: [
                { name: 'code', description: 'Code to review', required: true },
                { name: 'language', description: 'Programming language' },
              ],
            },
          ],
        }),
      }));

      expect(source).toContain('"code-review"');
      expect(source).toContain('"Review code"');
      expect(source).toContain("'--code <value>'");
      expect(source).toContain("'--language <value>'");
    });

    it('should include prompt list command', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain('listPrompts');
    });
  });

  describe('session commands', () => {
    it('should include session management commands', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("'sessions'");
      expect(source).toContain("'switch <name>'");
      expect(source).toContain("'delete <name>'");
      expect(source).toContain('switchSession');
      expect(source).toContain('listSessions');
    });

    it('should include connect command', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("'connect'");
      expect(source).toContain("'--token <token>'");
      expect(source).toContain("'--session <name>'");
    });
  });

  describe('serve command', () => {
    it('should include serve command for starting HTTP server', () => {
      const source = generateCliEntry(makeOptions({
        serverBundleFilename: 'my-app.bundle.js',
      }));
      expect(source).toContain("'serve'");
      expect(source).toContain('my-app.bundle.js');
    });
  });

  describe('daemon commands', () => {
    it('should include daemon start/stop/status/logs', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("'daemon'");
      expect(source).toContain("'start'");
      expect(source).toContain("'stop'");
      expect(source).toContain("'status'");
      expect(source).toContain("'logs'");
      expect(source).toContain('SIGTERM');
      expect(source).toContain('.pid');
    });
  });

  describe('doctor command', () => {
    it('should include doctor command', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("'doctor'");
      expect(source).toContain("'--fix'");
    });

    it('should include native dep checks when configured', () => {
      const source = generateCliEntry(makeOptions({
        nativeDeps: {
          brew: ['redis'],
          npm: ['sharp'],
        },
      }));

      expect(source).toContain('"redis"');
      expect(source).toContain("'brew'");
      expect(source).toContain('"sharp"');
      expect(source).toContain("'npm'");
    });
  });

  describe('install/uninstall commands', () => {
    it('should include install command', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("'install'");
      expect(source).toContain('.frontmcp');
    });

    it('should include uninstall command', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("'uninstall'");
      expect(source).toContain('rmSync');
    });
  });

  it('should set output default from config', () => {
    const sourceText = generateCliEntry(makeOptions({ outputDefault: 'text' }));
    expect(sourceText).toContain("'text'");

    const sourceJson = generateCliEntry(makeOptions({ outputDefault: 'json' }));
    expect(sourceJson).toContain("'json'");
  });

  it('should reference server bundle filename', () => {
    const source = generateCliEntry(makeOptions({
      serverBundleFilename: 'custom-server.bundle.js',
    }));
    expect(source).toContain('custom-server.bundle.js');
  });
});
