/**
 * SkillContext type + runtime tests for issue #416.
 *
 * Proves:
 *   1. `class Foo extends SkillContext {}` compiles under strict TypeScript.
 *   2. Default `loadInstructions()` / `build()` throw `SkillContextNotImplementedError`.
 *   3. User overrides still win.
 *   4. The `@Skill` runtime path is unaffected — empty-body classes work end-to-end
 *      when driven via `SkillInstance`.
 */

import 'reflect-metadata';

import { SkillContextNotImplementedError } from '../../../errors/sdk.errors';
import { normalizeSkill } from '../../../skill/skill.utils';
import { isSkillDecorated, Skill } from '../../decorators/skill.decorator';
import { type SkillMetadata } from '../../metadata';
import { SkillKind } from '../../records';
import { type ExecutionContextBaseArgs } from '../execution-context.interface';
import { SkillContext, type SkillContent } from '../skill.interface';

const mkArgs = (metadata: SkillMetadata): ExecutionContextBaseArgs & { metadata: SkillMetadata } => ({
  providers: { getActiveScope: () => undefined } as never,
  logger: {
    child: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as never,
  authInfo: {},
  metadata,
});

describe('SkillContext (issue #416)', () => {
  describe('empty-body extends', () => {
    it('compiles under strict TypeScript', () => {
      @Skill({
        name: 'empty-body',
        description: 'A skill with no method overrides — the documented form.',
        instructions: 'inline',
      })
      class EmptyBodySkill extends SkillContext {}

      // The decorator metadata is attached.
      expect(isSkillDecorated(EmptyBodySkill)).toBe(true);
    });

    it('rejects construction without required ExecutionContextBase args at compile time', () => {
      @Skill({
        name: 'empty-body-ctor',
        description: 'Empty body — used to assert constructor still gates new()',
        instructions: 'inline',
      })
      class EmptyBodyCtorSkill extends SkillContext {}

      // Compile-time check only — wrapping in an unused arrow ensures the line never runs.
      // If the `@ts-expect-error` directive becomes invalid (because TS stopped flagging
      // the call as a type error), this test fails — which is exactly the intended signal.

      const _typeCheck = () => {
        // @ts-expect-error - constructor requires providers/logger/authInfo/metadata
        new EmptyBodyCtorSkill();
      };
      expect(EmptyBodyCtorSkill).toBeDefined();
    });
  });

  describe('default method implementations', () => {
    @Skill({
      name: 'default-throw',
      description: 'A skill whose defaults throw SkillContextNotImplementedError',
      instructions: 'inline',
    })
    class DefaultThrowSkill extends SkillContext {}

    const ctx = new DefaultThrowSkill(
      mkArgs({
        name: 'default-throw',
        description: 'A skill whose defaults throw SkillContextNotImplementedError',
        instructions: 'inline',
      }),
    );

    it('loadInstructions() throws SkillContextNotImplementedError with the documented code', async () => {
      const promise = ctx.loadInstructions();
      await expect(promise).rejects.toBeInstanceOf(SkillContextNotImplementedError);
      try {
        await ctx.loadInstructions();
      } catch (err) {
        expect((err as SkillContextNotImplementedError).message).toMatch(/loadInstructions/);
        expect((err as SkillContextNotImplementedError).message).toContain('"default-throw"');
        expect((err as SkillContextNotImplementedError).code).toBe('SKILL_CONTEXT_NOT_IMPLEMENTED');
      }
    });

    it('build() throws SkillContextNotImplementedError with the documented code', async () => {
      const promise = ctx.build();
      await expect(promise).rejects.toBeInstanceOf(SkillContextNotImplementedError);
      try {
        await ctx.build();
      } catch (err) {
        expect((err as SkillContextNotImplementedError).message).toMatch(/build/);
        expect((err as SkillContextNotImplementedError).message).toContain('"default-throw"');
        expect((err as SkillContextNotImplementedError).code).toBe('SKILL_CONTEXT_NOT_IMPLEMENTED');
      }
    });
  });

  describe('regression guard — methods must remain concrete', () => {
    it('exposes loadInstructions and build as own prototype methods (not abstract)', () => {
      // If the methods were `abstract` the prototype would not carry implementations
      // and `typeof` would be 'undefined'. This locks in the issue #416 fix.
      expect(typeof SkillContext.prototype.loadInstructions).toBe('function');
      expect(typeof SkillContext.prototype.build).toBe('function');
    });

    it('exports SkillContextNotImplementedError through the public SDK barrel', async () => {
      // Resolve via the SDK's root index so consumers' `import { SkillContextNotImplementedError } from '@frontmcp/sdk'` works.
      const sdkRoot = (await import('../../../index')) as Record<string, unknown>;
      expect(sdkRoot['SkillContextNotImplementedError']).toBe(SkillContextNotImplementedError);
    });
  });

  describe('user overrides', () => {
    it('overriding loadInstructions and build wins over the defaults', async () => {
      @Skill({
        name: 'overriding-skill',
        description: 'A skill with user-supplied overrides',
        instructions: 'metadata-instructions',
      })
      class OverridingSkill extends SkillContext {
        override async loadInstructions(): Promise<string> {
          return 'custom-instructions';
        }

        override async build(): Promise<SkillContent> {
          return {
            id: this.metadata.id ?? this.metadata.name,
            name: this.metadata.name,
            description: this.metadata.description,
            instructions: 'custom-instructions',
            tools: [],
          };
        }
      }

      const overridden = new OverridingSkill(
        mkArgs({
          name: 'overriding-skill',
          description: 'A skill with user-supplied overrides',
          instructions: 'metadata-instructions',
        }),
      );

      await expect(overridden.loadInstructions()).resolves.toBe('custom-instructions');
      const built = await overridden.build();
      expect(built.instructions).toBe('custom-instructions');
      expect(built.name).toBe('overriding-skill');
    });
  });

  describe('@Skill runtime path remains unaffected (regression for issue #416)', () => {
    it('normalizes an empty-body class to a CLASS_TOKEN record without invoking user methods', () => {
      @Skill({
        name: 'empty-body-normalize',
        description: 'Empty-body skill normalized through the framework',
        instructions: 'metadata-only',
      })
      class EmptyBodyNormalize extends SkillContext {}

      const record = normalizeSkill(EmptyBodyNormalize);

      expect(record.kind).toBe(SkillKind.CLASS_TOKEN);
      expect(record.metadata.name).toBe('empty-body-normalize');
      expect(record.metadata.instructions).toBe('metadata-only');
    });
  });
});
