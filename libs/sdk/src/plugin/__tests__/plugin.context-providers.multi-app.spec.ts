/**
 * Two apps on one server install the same plugin with their own options, and the plugin contributes a
 * CONTEXT-scoped provider. Each app's tools, resources and prompts must resolve the provider of the plugin
 * that app installed, not the one the last app registered on the scope (#600).
 */
import 'reflect-metadata';

import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import {
  App,
  DynamicPlugin,
  LogLevel,
  Plugin,
  Prompt,
  PromptContext,
  ProviderScope,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
  type ProviderType,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

interface TenantOptions {
  tenant: string;
}

class TenantLabel {
  constructor(readonly tenant: string) {}
}

@Plugin({ name: 'tenant-label' })
class TenantLabelPlugin extends DynamicPlugin<TenantOptions> {
  readonly options: TenantOptions;

  constructor(options: TenantOptions) {
    super();
    this.options = options;
  }

  static override dynamicProviders(options: TenantOptions): ProviderType[] {
    return [
      {
        name: 'tenant-label',
        provide: TenantLabel,
        scope: ProviderScope.CONTEXT,
        inject: () => [] as const,
        useFactory: () => new TenantLabel(options.tenant),
      },
    ];
  }
}

@Tool({ name: 'alpha_tenant', inputSchema: {} })
class AlphaTenantTool extends ToolContext {
  async execute() {
    return { tenant: this.get(TenantLabel).tenant };
  }
}

@Tool({ name: 'beta_tenant', inputSchema: {} })
class BetaTenantTool extends ToolContext {
  async execute() {
    return { tenant: this.get(TenantLabel).tenant };
  }
}

@Resource({ name: 'alpha-tenant', uri: 'alpha://tenant' })
class AlphaTenantResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: this.get(TenantLabel).tenant }] };
  }
}

@Resource({ name: 'beta-tenant', uri: 'beta://tenant' })
class BetaTenantResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: this.get(TenantLabel).tenant }] };
  }
}

function tenantPrompt(tenant: string): GetPromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text: tenant } }] };
}

@Prompt({ name: 'alpha_tenant_prompt', arguments: [] })
class AlphaTenantPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return tenantPrompt(this.get(TenantLabel).tenant);
  }
}

@Prompt({ name: 'beta_tenant_prompt', arguments: [] })
class BetaTenantPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return tenantPrompt(this.get(TenantLabel).tenant);
  }
}

@Tool({ name: 'alpha_plugin_tenant', inputSchema: {} })
class AlphaPluginTenantTool extends ToolContext {
  async execute() {
    return { tenant: this.get(TenantLabel).tenant };
  }
}

@Plugin({ name: 'alpha-tenant-reader', tools: [AlphaPluginTenantTool] })
class AlphaTenantReaderPlugin {}

@App({
  id: 'alpha',
  name: 'Alpha',
  plugins: [TenantLabelPlugin.init({ tenant: 'alpha' }), AlphaTenantReaderPlugin],
  tools: [AlphaTenantTool],
  resources: [AlphaTenantResource],
  prompts: [AlphaTenantPrompt],
})
class AlphaApp {}

@App({
  id: 'beta',
  name: 'Beta',
  plugins: [TenantLabelPlugin.init({ tenant: 'beta' })],
  tools: [BetaTenantTool],
  resources: [BetaTenantResource],
  prompts: [BetaTenantPrompt],
})
class BetaApp {}

const CALLER = { authContext: { sessionId: 'session-tenant', user: { sub: 'alice' } } };

describe('CONTEXT-scoped plugin providers on two apps that install the same plugin', () => {
  let server: DirectMcpServer;

  async function toolTenant(name: string): Promise<unknown> {
    const result = await server.callTool(name, {}, CALLER);
    return (result.structuredContent as { tenant?: string } | undefined)?.tenant;
  }

  async function resourceTenant(uri: string): Promise<unknown> {
    const result = await server.readResource(uri, CALLER);
    return (result.contents[0] as { text?: string }).text;
  }

  async function promptTenant(name: string): Promise<unknown> {
    const result = await server.getPrompt(name, {}, CALLER);
    return (result.messages[0].content as { text?: string }).text;
  }

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'tenant-multi-app', version: '1.0.0' },
      apps: [AlphaApp, BetaApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('resolves the first app provider in the first app tool', async () => {
    await expect(toolTenant('alpha_tenant')).resolves.toBe('alpha');
  });

  it('resolves the second app provider in the second app tool', async () => {
    await expect(toolTenant('beta_tenant')).resolves.toBe('beta');
  });

  it('resolves the first app provider in a tool another plugin of the first app contributes', async () => {
    await expect(toolTenant('alpha_plugin_tenant')).resolves.toBe('alpha');
  });

  it('resolves each app provider in that app resource', async () => {
    await expect(resourceTenant('alpha://tenant')).resolves.toBe('alpha');
    await expect(resourceTenant('beta://tenant')).resolves.toBe('beta');
  });

  it('resolves each app provider in that app prompt', async () => {
    await expect(promptTenant('alpha_tenant_prompt')).resolves.toBe('alpha');
    await expect(promptTenant('beta_tenant_prompt')).resolves.toBe('beta');
  });

  it('keeps each app provider when the same session alternates between the apps', async () => {
    const tenants = [
      await toolTenant('alpha_tenant'),
      await toolTenant('beta_tenant'),
      await toolTenant('alpha_tenant'),
      await toolTenant('beta_tenant'),
    ];

    expect(tenants).toEqual(['alpha', 'beta', 'alpha', 'beta']);
  });
});
