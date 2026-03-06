import {
  generateCliEntry,
  CliEntryOptions,
  resolveToolCommandName,
  extractTemplateParams,
  RESERVED_COMMANDS,
} from '../cli-runtime/generate-cli-entry';
import { ExtractedSchema } from '../cli-runtime/schema-extractor';

function makeSchema(overrides?: Partial<ExtractedSchema>): ExtractedSchema {
  return {
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    capabilities: { skills: false, jobs: false, workflows: false },
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

  describe('tool name conflict resolution', () => {
    it('should append -tool suffix for reserved command names', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'resource',
              description: 'A tool named resource',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      }));

      expect(source).toContain('"resource-tool"');
      expect(source).toContain('callTool("resource"');
    });

    it('should rename login tool to login-tool', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'login',
              description: 'A tool named login',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      }));

      expect(source).toContain('"login-tool"');
    });

    it('should rename skills tool to skills-tool', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'skills',
              description: 'A tool named skills',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      }));

      expect(source).toContain('"skills-tool"');
      expect(source).toContain('callTool("skills"');
    });

    it('should rename job tool to job-tool', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'job',
              description: 'A tool named job',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      }));

      expect(source).toContain('"job-tool"');
      expect(source).toContain('callTool("job"');
    });

    it('should rename workflow tool to workflow-tool', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'workflow',
              description: 'A tool named workflow',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      }));

      expect(source).toContain('"workflow-tool"');
      expect(source).toContain('callTool("workflow"');
    });

    it('should not rename non-conflicting tool names', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'search',
              description: 'Search tool',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      }));

      expect(source).toContain('"search"');
      expect(source).not.toContain('"search-tool"');
    });

    it('should track tool command names for help grouping', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'my_tool',
              description: 'My tool',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      }));

      expect(source).toContain('_toolCommandNames');
      expect(source).toContain('"my-tool"');
    });
  });

  describe('JSON arg parsing', () => {
    it('should wrap object-typed args in JSON.parse', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'update_config',
              description: 'Update config',
              inputSchema: {
                type: 'object',
                properties: {
                  settings: { type: 'object', description: 'Config object' },
                },
              },
            },
          ],
        }),
      }));

      expect(source).toContain('JSON.parse');
      expect(source).toContain('Invalid JSON for --settings');
    });

    it('should not JSON.parse string-typed args', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'echo',
              description: 'Echo',
              inputSchema: {
                type: 'object',
                properties: {
                  message: { type: 'string', description: 'Message' },
                },
              },
            },
          ],
        }),
      }));

      // Should not have JSON.parse for a string field
      const lines = source.split('\n');
      const messageLines = lines.filter(l => l.includes('"message"'));
      const hasJsonParse = messageLines.some(l => l.includes('JSON.parse'));
      expect(hasJsonParse).toBe(false);
    });

    it('should handle nullable object types', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            {
              name: 'test_tool',
              description: 'Test',
              inputSchema: {
                type: 'object',
                properties: {
                  data: { type: ['object', 'null'], description: 'Data' },
                },
              },
            },
          ],
        }),
      }));

      expect(source).toContain('JSON.parse');
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

  describe('template commands', () => {
    it('should generate template list and read commands', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          resourceTemplates: [
            {
              uriTemplate: 'users://{userId}/profile',
              name: 'user_profile',
              description: 'Get user profile',
            },
          ],
        }),
      }));

      expect(source).toContain("'template'");
      expect(source).toContain('listResourceTemplates');
      expect(source).toContain('"user-profile"');
      expect(source).toContain("'--user-id <value>'");
      expect(source).toContain('users://{userId}/profile');
    });

    it('should extract multiple params from template', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          resourceTemplates: [
            {
              uriTemplate: 'repos://{owner}/{repo}/issues',
              name: 'repo_issues',
              description: 'List repo issues',
            },
          ],
        }),
      }));

      expect(source).toContain("'--owner <value>'");
      expect(source).toContain("'--repo <value>'");
    });

    it('should not generate template commands when no templates', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({ resourceTemplates: [] }),
      }));

      expect(source).toContain('// No resource templates extracted');
    });
  });

  describe('subscribe commands', () => {
    it('should include subscribe resource command', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("'subscribe'");
      expect(source).toContain("'resource <uri>'");
      expect(source).toContain('subscribeResource');
      expect(source).toContain('onResourceUpdated');
    });

    it('should include subscribe notification command', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("'notification <name>'");
      expect(source).toContain('onNotification');
    });

    it('should include SIGINT handler for graceful cleanup', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain('SIGINT');
      expect(source).toContain('Unsubscribing');
    });

    it('should use formatSubscriptionEvent for output', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain('formatSubscriptionEvent');
    });
  });

  describe('login command', () => {
    it('should include login command when authRequired', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain("'login'");
      expect(source).toContain("'--server <url>'");
      expect(source).toContain("'--session <name>'");
      expect(source).toContain("'--scope <scopes>'");
      expect(source).toContain("'--no-browser'");
    });

    it('should not include login command when authRequired is false', () => {
      const source = generateCliEntry(makeOptions({ authRequired: false }));
      expect(source).not.toContain("'login'");
    });

    it('should require server URL', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain('Server URL required');
      expect(source).toContain('FRONTMCP_SERVER_URL');
    });

    it('should use oauth helper for login flow', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain('oauthHelper.startOAuthLogin');
    });

    it('should store credentials after successful login', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain('creds.createCredentialStore');
      expect(source).toContain('Logged in successfully');
    });

    it('should use oauthConfig defaults when provided', () => {
      const source = generateCliEntry(makeOptions({
        authRequired: true,
        oauthConfig: {
          serverUrl: 'https://auth.example.com',
          clientId: 'my-client',
          defaultScope: 'read write',
          portRange: [18000, 18050],
          timeout: 60000,
        },
      }));

      expect(source).toContain('"https://auth.example.com"');
      expect(source).toContain('"my-client"');
      expect(source).toContain('"read write"');
      expect(source).toContain('18000');
      expect(source).toContain('18050');
      expect(source).toContain('60000');
    });
  });

  describe('logout command', () => {
    it('should include logout command when authRequired', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain("'logout'");
      expect(source).toContain("'--session <name>'");
      expect(source).toContain("'--all'");
    });

    it('should not include logout command when authRequired is false', () => {
      const source = generateCliEntry(makeOptions({ authRequired: false }));
      expect(source).not.toContain("'logout'");
    });

    it('should support logging out all sessions', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain('store.list()');
      expect(source).toContain('session(s)');
    });

    it('should use active session by default', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain('sessions.getActiveSessionName()');
    });
  });

  describe('auth error handling', () => {
    it('should detect authorization_required in tool errors', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [{
            name: 'protected_tool',
            description: 'Needs auth',
            inputSchema: { type: 'object', properties: {} },
          }],
        }),
      }));

      expect(source).toContain('authorization_required');
      expect(source).toContain('Authorization required');
      expect(source).toContain('login');
    });
  });

  describe('auth token injection', () => {
    it('should inject auth token in getClient when authRequired', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain('credBlob');
      expect(source).toContain('authToken');
      expect(source).toContain('getActiveSessionName');
    });

    it('should not inject auth token when authRequired is false', () => {
      const source = generateCliEntry(makeOptions({ authRequired: false }));
      expect(source).not.toContain('credBlob');
      expect(source).not.toContain('authToken');
    });
  });

  describe('oauth helper require', () => {
    it('should require oauth-helper when oauthConfig is provided', () => {
      const source = generateCliEntry(makeOptions({
        oauthConfig: { serverUrl: 'https://auth.example.com' },
      }));
      expect(source).toContain("require('./oauth-helper')");
    });

    it('should not require oauth-helper at top level when no oauthConfig', () => {
      const source = generateCliEntry(makeOptions());
      // login command always requires it locally, but header shouldn't have it
      const headerSection = source.split('var program')[0];
      expect(headerSection).not.toContain("var oauthHelper = require('./oauth-helper')");
    });
  });

  describe('grouped help output', () => {
    it('should configure custom help formatter', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain('configureHelp');
      expect(source).toContain('formatHelp');
    });

    it('should group commands into categories', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain("'Tools'");
      expect(source).toContain("'Resources & Prompts'");
      expect(source).toContain("'System'");
      expect(source).toContain("'Subscriptions'");
    });

    it('should not include Auth group when authRequired is false', () => {
      const source = generateCliEntry(makeOptions({ authRequired: false }));
      // Auth group should not be in the groups object
      expect(source).not.toContain("'Auth': []");
    });

    it('should include Auth group when authRequired is true', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain("'Auth'");
    });

    it('should include Skills group when skills capability is true', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({ capabilities: { skills: true, jobs: false, workflows: false } }),
      }));
      expect(source).toContain("'Skills'");
      expect(source).toContain("'skills'");
    });

    it('should include Jobs group when jobs capability is true', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({ capabilities: { skills: false, jobs: true, workflows: false } }),
      }));
      expect(source).toContain("'Jobs'");
      expect(source).toContain("'job'");
    });

    it('should include Workflows group when workflows capability is true', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({ capabilities: { skills: false, jobs: false, workflows: true } }),
      }));
      expect(source).toContain("'Workflows'");
      expect(source).toContain("'workflow'");
    });

    it('should default to outputHelp when no args', () => {
      const source = generateCliEntry(makeOptions());
      expect(source).toContain('program.action(function() { program.outputHelp(); })');
    });
  });

  describe('system tool filtering', () => {
    it('should not include searchSkills as a tool command', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            { name: 'searchSkills', description: 'Search skills', inputSchema: { type: 'object', properties: {} } },
            { name: 'my_tool', description: 'My tool', inputSchema: { type: 'object', properties: {} } },
          ],
          capabilities: { skills: true, jobs: false, workflows: false },
        }),
      }));

      expect(source).not.toContain('callTool("searchSkills"');
      expect(source).toContain('callTool("my_tool"');
    });

    it('should not include loadSkills as a tool command', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            { name: 'loadSkills', description: 'Load skills', inputSchema: { type: 'object', properties: {} } },
          ],
          capabilities: { skills: true, jobs: false, workflows: false },
        }),
      }));

      expect(source).not.toContain('callTool("loadSkills"');
    });

    it('should not include execute-job as a tool command', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            { name: 'execute-job', description: 'Execute job', inputSchema: { type: 'object', properties: {} } },
            { name: 'get-job-status', description: 'Job status', inputSchema: { type: 'object', properties: {} } },
          ],
          capabilities: { skills: false, jobs: true, workflows: false },
        }),
      }));

      expect(source).not.toContain('callTool("execute-job"');
      expect(source).not.toContain('callTool("get-job-status"');
    });

    it('should not include list-jobs, register-job, or remove-job as tool commands', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            { name: 'list-jobs', description: 'List jobs', inputSchema: { type: 'object', properties: {} } },
            { name: 'register-job', description: 'Register job', inputSchema: { type: 'object', properties: {} } },
            { name: 'remove-job', description: 'Remove job', inputSchema: { type: 'object', properties: {} } },
            { name: 'my_tool', description: 'My tool', inputSchema: { type: 'object', properties: {} } },
          ],
          capabilities: { skills: false, jobs: true, workflows: false },
        }),
      }));

      expect(source).not.toContain('callTool("list-jobs"');
      expect(source).not.toContain('callTool("register-job"');
      expect(source).not.toContain('callTool("remove-job"');
      expect(source).toContain('callTool("my_tool"');
    });

    it('should not include list-workflows, register-workflow, or remove-workflow as tool commands', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            { name: 'list-workflows', description: 'List workflows', inputSchema: { type: 'object', properties: {} } },
            { name: 'register-workflow', description: 'Register workflow', inputSchema: { type: 'object', properties: {} } },
            { name: 'remove-workflow', description: 'Remove workflow', inputSchema: { type: 'object', properties: {} } },
          ],
          capabilities: { skills: false, jobs: false, workflows: true },
        }),
      }));

      expect(source).not.toContain('callTool("list-workflows"');
      expect(source).not.toContain('callTool("register-workflow"');
      expect(source).not.toContain('callTool("remove-workflow"');
    });

    it('should not include execute-workflow as a tool command', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({
          tools: [
            { name: 'execute-workflow', description: 'Execute workflow', inputSchema: { type: 'object', properties: {} } },
            { name: 'get-workflow-status', description: 'Workflow status', inputSchema: { type: 'object', properties: {} } },
          ],
          capabilities: { skills: false, jobs: false, workflows: true },
        }),
      }));

      expect(source).not.toContain('callTool("execute-workflow"');
      expect(source).not.toContain('callTool("get-workflow-status"');
    });
  });

  describe('skills commands', () => {
    it('should generate skills commands when skills capability is true', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({ capabilities: { skills: true, jobs: false, workflows: false } }),
      }));

      expect(source).toContain("'skills'");
      expect(source).toContain("'search [query]'");
      expect(source).toContain("'load <ids...>'");
      expect(source).toContain('searchSkills');
      expect(source).toContain('loadSkills');
      expect(source).toContain('listSkills');
    });

    it('should not generate skills commands when skills capability is false', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({ capabilities: { skills: false, jobs: false, workflows: false } }),
      }));

      expect(source).not.toContain('searchSkills');
      expect(source).not.toContain('listSkills');
    });
  });

  describe('job commands', () => {
    it('should generate job commands when jobs capability is true', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({ capabilities: { skills: false, jobs: true, workflows: false } }),
      }));

      expect(source).toContain("'job'");
      expect(source).toContain("'run <name>'");
      expect(source).toContain("'status <runId>'");
      expect(source).toContain('listJobs');
      expect(source).toContain('executeJob');
      expect(source).toContain('getJobStatus');
    });

    it('should not generate job commands when jobs capability is false', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({ capabilities: { skills: false, jobs: false, workflows: false } }),
      }));

      expect(source).not.toContain('listJobs');
      expect(source).not.toContain('executeJob');
    });

    it('should include --input and --background options for job run', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({ capabilities: { skills: false, jobs: true, workflows: false } }),
      }));

      expect(source).toContain("'--input <json>'");
      expect(source).toContain("'--background'");
    });
  });

  describe('workflow commands', () => {
    it('should generate workflow commands when workflows capability is true', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({ capabilities: { skills: false, jobs: false, workflows: true } }),
      }));

      expect(source).toContain("'workflow'");
      expect(source).toContain('listWorkflows');
      expect(source).toContain('executeWorkflow');
      expect(source).toContain('getWorkflowStatus');
    });

    it('should not generate workflow commands when workflows capability is false', () => {
      const source = generateCliEntry(makeOptions({
        schema: makeSchema({ capabilities: { skills: false, jobs: false, workflows: false } }),
      }));

      expect(source).not.toContain('listWorkflows');
      expect(source).not.toContain('executeWorkflow');
    });
  });

  describe('conditional auth commands', () => {
    it('should not include auth commands when authRequired is false', () => {
      const source = generateCliEntry(makeOptions({ authRequired: false }));
      expect(source).not.toContain("'login'");
      expect(source).not.toContain("'logout'");
      expect(source).not.toContain("'sessions'");
      expect(source).not.toContain("'connect'");
    });

    it('should include auth commands when authRequired is true', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain("'login'");
      expect(source).toContain("'logout'");
      expect(source).toContain("'sessions'");
      expect(source).toContain("'connect'");
    });

    it('should not require session-manager when authRequired is false', () => {
      const source = generateCliEntry(makeOptions({ authRequired: false }));
      expect(source).not.toContain("require('./session-manager')");
      expect(source).not.toContain("require('./credential-store')");
    });

    it('should require session-manager when authRequired is true', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain("require('./session-manager')");
      expect(source).toContain("require('./credential-store')");
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
    it('should include session management commands when authRequired', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain("'sessions'");
      expect(source).toContain("'switch <name>'");
      expect(source).toContain("'delete <name>'");
      expect(source).toContain('switchSession');
      expect(source).toContain('listSessions');
    });

    it('should include connect command when authRequired', () => {
      const source = generateCliEntry(makeOptions({ authRequired: true }));
      expect(source).toContain("'connect'");
      expect(source).toContain("'--token <token>'");
      expect(source).toContain("'--session <name>'");
    });

    it('should not include session commands when authRequired is false', () => {
      const source = generateCliEntry(makeOptions({ authRequired: false }));
      expect(source).not.toContain("'sessions'");
      expect(source).not.toContain("'connect'");
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

describe('resolveToolCommandName', () => {
  it('should return original name when not reserved', () => {
    const result = resolveToolCommandName('search_users');
    expect(result.cmdName).toBe('search-users');
    expect(result.wasRenamed).toBe(false);
  });

  it('should append -tool for reserved names', () => {
    const result = resolveToolCommandName('resource');
    expect(result.cmdName).toBe('resource-tool');
    expect(result.wasRenamed).toBe(true);
  });

  it('should handle all reserved commands', () => {
    const reserved = [
      'resource', 'template', 'prompt', 'subscribe',
      'login', 'logout', 'connect', 'serve', 'daemon',
      'doctor', 'install', 'uninstall', 'sessions', 'help', 'version',
      'skills', 'job', 'workflow',
    ];
    reserved.forEach(name => {
      const result = resolveToolCommandName(name);
      expect(result.cmdName).toBe(`${name}-tool`);
      expect(result.wasRenamed).toBe(true);
    });
  });

  it('should convert camelCase to kebab-case', () => {
    const result = resolveToolCommandName('getUser');
    expect(result.cmdName).toBe('get-user');
    expect(result.wasRenamed).toBe(false);
  });

  it('should convert underscores to hyphens', () => {
    const result = resolveToolCommandName('get_user');
    expect(result.cmdName).toBe('get-user');
    expect(result.wasRenamed).toBe(false);
  });
});

describe('extractTemplateParams', () => {
  it('should extract single param', () => {
    expect(extractTemplateParams('users://{userId}/profile')).toEqual(['userId']);
  });

  it('should extract multiple params', () => {
    expect(extractTemplateParams('repos://{owner}/{repo}/issues')).toEqual(['owner', 'repo']);
  });

  it('should return empty array for no params', () => {
    expect(extractTemplateParams('static://resource')).toEqual([]);
  });

  it('should handle params with various characters', () => {
    expect(extractTemplateParams('data://{my-param}/{another_param}')).toEqual(['my-param', 'another_param']);
  });
});

describe('RESERVED_COMMANDS', () => {
  it('should contain all expected reserved names', () => {
    expect(RESERVED_COMMANDS.has('resource')).toBe(true);
    expect(RESERVED_COMMANDS.has('template')).toBe(true);
    expect(RESERVED_COMMANDS.has('login')).toBe(true);
    expect(RESERVED_COMMANDS.has('logout')).toBe(true);
    expect(RESERVED_COMMANDS.has('subscribe')).toBe(true);
    expect(RESERVED_COMMANDS.has('help')).toBe(true);
    expect(RESERVED_COMMANDS.has('version')).toBe(true);
    expect(RESERVED_COMMANDS.has('skills')).toBe(true);
    expect(RESERVED_COMMANDS.has('job')).toBe(true);
    expect(RESERVED_COMMANDS.has('workflow')).toBe(true);
  });

  it('should not contain non-reserved names', () => {
    expect(RESERVED_COMMANDS.has('search')).toBe(false);
    expect(RESERVED_COMMANDS.has('query')).toBe(false);
  });
});
