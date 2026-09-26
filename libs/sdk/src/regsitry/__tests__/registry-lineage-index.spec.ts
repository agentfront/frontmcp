/** `lineageOf` is O(1) on every entry registry and follows adoption, replacement and reindex (#598). */
import 'reflect-metadata';

import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import { createMockOwner, createMockProviderRegistry } from '../../__test-utils__/mocks';
import {
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
  type EntryLineage,
  type EntryOwnerRef,
  type PromptType,
  type ResourceType,
  type ToolType,
} from '../../common';
import PromptRegistry from '../../prompt/prompt.registry';
import ResourceRegistry from '../../resource/resource.registry';
import ToolRegistry from '../../tool/tool.registry';

type Variant = 'alpha' | 'beta';

interface LineageHarness<Registry, Entry> {
  create(variant: Variant, owner: EntryOwnerRef): Promise<Registry>;
  entries(registry: Registry): readonly Entry[];
  lineageOf(registry: Registry, entry: Entry): EntryLineage | undefined;
  adopt(parent: Registry, child: Registry, childOwner: EntryOwnerRef): void;
  replace(registry: Registry, variant: Variant, owner: EntryOwnerRef): void;
}

const gateway = createMockOwner('gateway', 'scope');
const orders = createMockOwner('orders', 'app');
const billing = createMockOwner('billing', 'app');

function ownerPath(lineage: EntryLineage | undefined): string[] | undefined {
  return lineage?.map((owner) => `${owner.kind}:${owner.id}`);
}

function onlyEntry<Entry>(entries: readonly Entry[]): Entry {
  const [entry] = entries;
  if (entries.length !== 1 || entry === undefined) {
    throw new Error(`expected exactly one entry, got ${entries.length}`);
  }
  return entry;
}

function describeLineageIndex<Registry extends object, Entry>(
  name: string,
  harness: LineageHarness<Registry, Entry>,
): void {
  describe(`${name}.lineageOf`, () => {
    it('resolves an entry without listing every row of the registry', async () => {
      const registry = await harness.create('alpha', orders);
      const entry = onlyEntry(harness.entries(registry));
      const listAllIndexed = jest.spyOn(registry as unknown as { listAllIndexed(): unknown[] }, 'listAllIndexed');

      for (let lookup = 0; lookup < 3; lookup++) {
        expect(ownerPath(harness.lineageOf(registry, entry))).toEqual(['app:orders']);
      }
      expect(listAllIndexed).not.toHaveBeenCalled();
    });

    it('returns undefined for an entry the registry does not hold', async () => {
      const registry = await harness.create('alpha', orders);
      const elsewhere = await harness.create('beta', billing);

      expect(harness.lineageOf(registry, onlyEntry(harness.entries(elsewhere)))).toBeUndefined();
    });

    it('prepends its own owner to the entries it adopts from a child', async () => {
      const parent = await harness.create('beta', gateway);
      const child = await harness.create('alpha', orders);

      harness.adopt(parent, child, orders);

      expect(ownerPath(harness.lineageOf(parent, onlyEntry(harness.entries(child))))).toEqual([
        'scope:gateway',
        'app:orders',
      ]);
    });

    it('follows a child that replaces its entries after adoption', async () => {
      const parent = await harness.create('beta', gateway);
      const child = await harness.create('alpha', orders);
      harness.adopt(parent, child, orders);
      const replaced = onlyEntry(harness.entries(child));

      harness.replace(child, 'beta', orders);
      const replacement = onlyEntry(harness.entries(child));

      expect(harness.lineageOf(parent, replaced)).toBeUndefined();
      expect(ownerPath(harness.lineageOf(parent, replacement))).toEqual(['scope:gateway', 'app:orders']);
    });

    it('drops replaced entries and indexes their replacements under the new owner', async () => {
      const registry = await harness.create('alpha', orders);
      const replaced = onlyEntry(harness.entries(registry));

      harness.replace(registry, 'beta', billing);
      const replacement = onlyEntry(harness.entries(registry));

      expect(harness.lineageOf(registry, replaced)).toBeUndefined();
      expect(ownerPath(harness.lineageOf(registry, replacement))).toEqual(['app:billing']);
    });
  });
}

@Tool({ name: 'alpha_tool', inputSchema: {} })
class AlphaTool extends ToolContext {
  async execute() {
    return {};
  }
}

@Tool({ name: 'beta_tool', inputSchema: {} })
class BetaTool extends ToolContext {
  async execute() {
    return {};
  }
}

const tools: Record<Variant, ToolType> = { alpha: AlphaTool, beta: BetaTool };

describeLineageIndex('ToolRegistry', {
  async create(variant, owner) {
    const registry = new ToolRegistry(createMockProviderRegistry(), [tools[variant]], owner);
    await registry.ready;
    return registry;
  },
  entries: (registry) => registry.listAllInstances(),
  lineageOf: (registry, entry) => registry.lineageOf(entry),
  adopt: (parent, child, childOwner) => parent.adoptFromChild(child, childOwner),
  replace: (registry, variant, owner) => registry.replaceAll([tools[variant]], owner),
});

function textResource(uri: string): ReadResourceResult {
  return { contents: [{ uri, text: uri }] };
}

@Resource({ name: 'alpha-resource', uri: 'alpha://resource' })
class AlphaResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@Resource({ name: 'beta-resource', uri: 'beta://resource' })
class BetaResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

const resources: Record<Variant, ResourceType> = { alpha: AlphaResource, beta: BetaResource };

describeLineageIndex('ResourceRegistry', {
  async create(variant, owner) {
    const registry = new ResourceRegistry(createMockProviderRegistry(), [resources[variant]], owner);
    await registry.ready;
    return registry;
  },
  entries: (registry) => registry.listAllInstances(),
  lineageOf: (registry, entry) => registry.lineageOf(entry),
  adopt: (parent, child, childOwner) => parent.adoptFromChild(child, childOwner),
  replace: (registry, variant, owner) => registry.replaceAll([resources[variant]], owner),
});

function textPrompt(text: string): GetPromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}

@Prompt({ name: 'alpha-prompt', arguments: [] })
class AlphaPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return textPrompt('alpha');
  }
}

@Prompt({ name: 'beta-prompt', arguments: [] })
class BetaPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return textPrompt('beta');
  }
}

const prompts: Record<Variant, PromptType> = { alpha: AlphaPrompt, beta: BetaPrompt };

describeLineageIndex('PromptRegistry', {
  async create(variant, owner) {
    const registry = new PromptRegistry(createMockProviderRegistry(), [prompts[variant]], owner);
    await registry.ready;
    return registry;
  },
  entries: (registry) => registry.listAllInstances(),
  lineageOf: (registry, entry) => registry.lineageOf(entry),
  adopt: (parent, child, childOwner) => parent.adoptFromChild(child, childOwner),
  replace: (registry, variant, owner) => registry.replaceAll([prompts[variant]], owner),
});
