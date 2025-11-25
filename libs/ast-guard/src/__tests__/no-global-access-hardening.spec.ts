import { JSAstValidator } from '../validator';
import { Presets } from '../presets';
import { createAgentScriptPreset } from '../presets/agentscript.preset';

/**
 * Hardening tests for the NoGlobalAccessRule.
 *
 * These scenarios attempt to reach dangerous globals by combining destructuring,
 * dynamic property lookups, and aliasing tricks that historically enabled
 * sandbox escapes. Both the strict preset and the AgentScript preset should
 * reject these patterns before execution.
 */

type PresetFactory = {
  name: string;
  createRules: () => ReturnType<typeof Presets.strict>;
};

const presetMatrix: PresetFactory[] = [
  {
    name: 'Strict preset',
    createRules: () => Presets.strict(),
  },
  {
    name: 'AgentScript preset',
    createRules: () => createAgentScriptPreset(),
  },
];

describe.each(presetMatrix)('NoGlobalAccess hardening - %s', ({ createRules }) => {
  let validator: JSAstValidator;

  beforeEach(() => {
    validator = new JSAstValidator(createRules());
  });

  it('blocks destructuring globalThis to reach eval', async () => {
    const attack = `
      const { eval: run } = globalThis;
      run('return process.env');
    `;

    const result = await validator.validate(attack);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'NO_GLOBAL_DESTRUCTURE')).toBe(true);
  });

  it('blocks dynamic property reads on "this" (constructor chain obfuscation)', async () => {
    const attack = `
      const key = 'constr' + 'uctor';
      const ctor = this[key];
      const runner = ctor && ctor('return globalThis');
      runner && runner();
    `;

    const result = await validator.validate(attack);

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === 'NO_GLOBAL_ACCESS' && issue.data?.['accessType'] === 'computed'),
    ).toBe(true);
  });

  it('blocks computed destructuring keys sourced from window clones', async () => {
    const attack = `
      const { ['constructor']: ctor } = window;
      ctor && ctor('return process');
    `;

    const result = await validator.validate(attack);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'NO_GLOBAL_DESTRUCTURE')).toBe(true);
  });

  it('blocks attempts to reach host logger via globalThis property access', async () => {
    const attack = `
      const logger = globalThis.logger;
      logger.info('exfiltration');
    `;

    const result = await validator.validate(attack);

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === 'NO_GLOBAL_ACCESS' &&
          issue.data?.['global'] === 'globalThis' &&
          issue.data?.['property'] === 'logger',
      ),
    ).toBe(true);
  });

  it('blocks optional chaining access to sandboxManager on this', async () => {
    const attack = `
      const manager = this?.['sandboxManager'];
      manager?.shutdown();
    `;

    const result = await validator.validate(attack);

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === 'NO_GLOBAL_ACCESS' && issue.data?.['accessType'] === 'computed'),
    ).toBe(true);
  });
});
