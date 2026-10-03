/**
 * The tools a `@Skill` references, and what `toolValidation` does when one is missing (#678).
 *
 * `@Skill({ tools: [ToolClass] })` stopped the server from starting: the metadata schema parsed the
 * class with `z.function()`, which returns a validating wrapper in place of the class, so the
 * wrapper had no `@Tool` metadata and the skill failed with "Invalid tool class ''". And
 * `toolValidation: 'strict'` with a tool that doesn't exist started the server anyway: the registry
 * only threw when built with `failOnInvalidSkills`, which nothing set, and logged nothing either.
 */
import 'reflect-metadata';

import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { App, LogLevel, Skill, SkillContext, Tool, ToolContext } from '../../common';
import { skillMetadataSchema } from '../../common/metadata/skill.metadata';
import { connect } from '../../direct';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { SkillValidationError } from '../errors/skill-validation.error';
import SkillRegistry from '../skill.registry';

@Tool({ name: 'lookup_order', description: 'Look up an order', inputSchema: {} })
class LookupOrderTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

/** Registered and called as `refund_v2`, its `id`, not its `name`. */
@Tool({ id: 'refund_v2', name: 'refund', description: 'Refund an order', inputSchema: {} })
class RefundTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

/** Not a `@Tool`. */
class PlainClass {}

@Skill({
  name: 'order-support',
  description: 'Handle order questions',
  instructions: 'Look the order up, then refund it.',
  tools: [LookupOrderTool, { tool: RefundTool, purpose: 'Refund the order', required: true }],
  toolValidation: 'strict',
})
class OrderSupportSkill extends SkillContext {}

@App({ id: 'orders', name: 'Orders', tools: [LookupOrderTool, RefundTool], skills: [OrderSupportSkill] })
class OrdersApp {}

describe('a skill that references tool classes', () => {
  it('keeps the class as it is, so its @Tool name can be read', () => {
    const parsed = skillMetadataSchema.parse({
      name: 'by-class',
      description: 'd',
      instructions: 'i',
      tools: [LookupOrderTool, { tool: RefundTool }],
    });

    expect(parsed.tools?.[0]).toBe(LookupOrderTool);
    expect((parsed.tools?.[1] as { tool: unknown }).tool).toBe(RefundTool);
  });

  it('refuses a value that is neither a name, a class nor a reference', () => {
    expect(() =>
      skillMetadataSchema.parse({ name: 'bad', description: 'd', instructions: 'i', tools: [42] }),
    ).toThrow();
  });

  it('starts the server and lists the tools by the names they are called under', async () => {
    const client = await connect({
      info: { name: 'skill-tool-classes', version: '1.0.0' },
      apps: [OrdersApp],
      logging: { level: LogLevel.Off },
      skillsConfig: { enabled: true },
    });
    try {
      const { skills } = await client.loadSkills(['order-support']);
      const [skill] = skills;

      expect(skill.availableTools.sort()).toEqual(['lookup_order', 'refund_v2']);
      expect(skill.missingTools).toEqual([]);
    } finally {
      await client.close();
    }
  });
});

describe("toolValidation: 'strict'", () => {
  @Skill({
    name: 'needs-missing-tool',
    description: 'References a tool nobody registered',
    instructions: 'Call the missing tool.',
    tools: ['lookup_order', 'no_such_tool'],
    toolValidation: 'strict',
  })
  class StrictSkill extends SkillContext {}

  @Skill({
    name: 'warns-about-missing-tool',
    description: 'References a tool nobody registered',
    instructions: 'Call the missing tool.',
    tools: ['no_such_tool'],
  })
  class WarnSkill extends SkillContext {}

  @App({ id: 'strict', name: 'Strict', tools: [LookupOrderTool], skills: [StrictSkill] })
  class StrictApp {}

  @App({ id: 'lenient', name: 'Lenient', tools: [LookupOrderTool], skills: [WarnSkill] })
  class LenientApp {}

  it('stops the server from starting when a referenced tool is not registered', async () => {
    const start = FrontMcpInstance.createDirect({
      info: { name: 'skill-strict', version: '1.0.0' },
      apps: [StrictApp],
      logging: { level: LogLevel.Off },
    });

    await expect(start).rejects.toBeInstanceOf(SkillValidationError);
    await expect(start).rejects.toThrow(
      "Skill 'needs-missing-tool' failed tool validation: missing tools [no_such_tool]",
    );
  });

  it("still starts the server in the default 'warn' mode", async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'skill-warn', version: '1.0.0' },
      apps: [LenientApp],
      logging: { level: LogLevel.Off },
    });
    await server.dispose();
  });
});

describe('SkillRegistry.validateAllTools', () => {
  async function registryFor(skills: unknown[], options?: { failOnInvalidSkills?: boolean }) {
    const providers = await createProviderRegistryWithScope();
    const scope = providers.getActiveScope() as unknown as Record<string, unknown>;
    // Only `lookup_order` is registered
    scope['tools'] = { getTools: () => [{ name: 'lookup_order' }] };
    const owner = { kind: 'app' as const, id: 'orders', ref: Symbol('orders') };
    const registry = new SkillRegistry(providers, skills as never[], owner, options);
    await registry.ready;
    return { registry, logger: scope['logger'] as { error: jest.Mock; warn: jest.Mock } };
  }

  @Skill({
    name: 'strict-a',
    description: 'd',
    instructions: 'i',
    tools: ['missing_a'],
    toolValidation: 'strict',
  })
  class StrictA extends SkillContext {}

  @Skill({
    name: 'strict-b',
    description: 'd',
    instructions: 'i',
    tools: ['lookup_order', 'missing_b'],
    toolValidation: 'strict',
  })
  class StrictB extends SkillContext {}

  it('names every failed skill and its missing tools', async () => {
    const { registry } = await registryFor([StrictA, StrictB]);

    await expect(registry.validateAllTools()).rejects.toThrow(
      "2 skill(s) failed tool validation: 'strict-a' (missing tools [missing_a]), 'strict-b' (missing tools [missing_b])",
    );
  });

  it('reports the failure and logs it as an error with failOnInvalidSkills: false', async () => {
    const { registry, logger } = await registryFor([StrictA], { failOnInvalidSkills: false });

    const report = await registry.validateAllTools();

    expect(report.isValid).toBe(false);
    expect(report.results[0]).toEqual(expect.objectContaining({ status: 'failed', missingTools: ['missing_a'] }));
    expect(logger.error).toHaveBeenCalledWith(
      `Skill "strict-a" (toolValidation: 'strict') references missing tools: missing_a`,
    );
  });

  it('refuses a class in tools that is not a @Tool', async () => {
    const providers = await createProviderRegistryWithScope();
    const owner = { kind: 'app' as const, id: 'orders', ref: Symbol('orders') };
    @Skill({ name: 'plain-class', description: 'd', instructions: 'i', tools: [PlainClass as never] })
    class PlainClassSkill extends SkillContext {}

    const registry = new SkillRegistry(providers, [PlainClassSkill], owner);
    await registry.ready;

    await expect(registry.validateAllTools()).rejects.toThrow(
      "Invalid tool class 'PlainClass'. Tool class must be decorated with @Tool and have a name property.",
    );
  });
});
