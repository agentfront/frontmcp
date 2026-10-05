/** `.esm()` / `.remote()` entries load when a registry starts; adding one to a started registry is refused. */
import 'reflect-metadata';

import { createMockOwner, createMockProviderRegistry } from '../../__test-utils__/mocks';
import { Prompt, Resource, Tool, ToolContext } from '../../common';
import { ExternalEntryNotSupportedError } from '../../errors';
import PromptRegistry from '../../prompt/prompt.registry';
import ResourceRegistry from '../../resource/resource.registry';
import ToolRegistry from '../../tool/tool.registry';

const owner = createMockOwner('catalog', 'app');

@Tool({ name: 'local_tool', inputSchema: {} })
class LocalTool extends ToolContext {
  async execute() {
    return {};
  }
}

describe('adding .esm() / .remote() entries to a started registry', () => {
  it('ToolRegistry.replaceAll refuses them and keeps its tools', async () => {
    const registry = new ToolRegistry(createMockProviderRegistry(), [LocalTool], owner);
    await registry.ready;

    expect(() => registry.replaceAll([Tool.esm('@acme/tools@^1.0.0', 'echo')], owner)).toThrow(
      'Tool "echo" from @acme/tools@^1.0.0 is not supported: .esm() and .remote() entries are loaded when their registry starts',
    );
    expect(() => registry.replaceAll(['@acme/tools@^1.0.0'], owner)).toThrow(ExternalEntryNotSupportedError);
    expect(registry.listAllInstances().map((tool) => tool.name)).toEqual(['local_tool']);
  });

  it('ResourceRegistry.replaceAll and registerDynamicResource refuse them', async () => {
    const registry = new ResourceRegistry(createMockProviderRegistry(), [], owner);
    await registry.ready;
    const entry = Resource.remote('https://api.example.com/mcp', 'status');

    expect(() => registry.replaceAll([entry], owner)).toThrow(ExternalEntryNotSupportedError);
    expect(() => registry.registerDynamicResource(entry)).toThrow(
      'Resource "status" from https://api.example.com/mcp is not supported',
    );
  });

  it('PromptRegistry.replaceAll refuses them', async () => {
    const registry = new PromptRegistry(createMockProviderRegistry(), [], owner);
    await registry.ready;

    expect(() => registry.replaceAll([Prompt.esm('@acme/tools@^1.0.0', 'greet')], owner)).toThrow(
      ExternalEntryNotSupportedError,
    );
  });
});
