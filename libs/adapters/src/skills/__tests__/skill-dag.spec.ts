import type { BundledSkill } from '../bundle/bundle.types';
import { resolveSkillLoadOrder, SkillDependencyCycleError, SkillDependencyMissingError } from '../dependency/skill-dag';

const skill = (id: string, requires?: string[]): BundledSkill => ({
  id,
  name: id,
  description: `desc-${id}`,
  instructions: `# ${id}`,
  operationIds: [],
  ...(requires && { requires }),
});

describe('resolveSkillLoadOrder', () => {
  it('returns skills as-is when no requires are declared', () => {
    const skills = [skill('a'), skill('b'), skill('c')];
    const ordered = resolveSkillLoadOrder(skills);
    expect(ordered.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('places dependencies before dependents', () => {
    const ordered = resolveSkillLoadOrder([skill('app', ['lib']), skill('lib')]);
    expect(ordered.map((s) => s.id)).toEqual(['lib', 'app']);
  });

  it('uses alphabetical tie-break among independent zero-deps', () => {
    const ordered = resolveSkillLoadOrder([skill('z'), skill('a'), skill('m')]);
    expect(ordered.map((s) => s.id)).toEqual(['a', 'm', 'z']);
  });

  it('handles a chain a <- b <- c', () => {
    const ordered = resolveSkillLoadOrder([skill('c', ['b']), skill('b', ['a']), skill('a')]);
    expect(ordered.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles a diamond shape', () => {
    // d depends on b and c; b and c both depend on a.
    const ordered = resolveSkillLoadOrder([skill('d', ['b', 'c']), skill('b', ['a']), skill('c', ['a']), skill('a')]);
    expect(ordered[0].id).toBe('a');
    expect(ordered[ordered.length - 1].id).toBe('d');
    // 'b' and 'c' come in alphabetical tie-break order
    expect(ordered.slice(1, 3).map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('throws SkillDependencyMissingError when a required id is unknown', () => {
    expect(() => resolveSkillLoadOrder([skill('a', ['ghost'])])).toThrow(SkillDependencyMissingError);
  });

  it('throws SkillDependencyCycleError on a 2-node cycle', () => {
    expect(() => resolveSkillLoadOrder([skill('a', ['b']), skill('b', ['a'])])).toThrow(SkillDependencyCycleError);
  });

  it('throws SkillDependencyCycleError on a 3-node cycle and reports the chain', () => {
    try {
      resolveSkillLoadOrder([skill('a', ['b']), skill('b', ['c']), skill('c', ['a'])]);
      fail('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SkillDependencyCycleError);
      const cycle = (e as SkillDependencyCycleError).cycle;
      // First and last id match — the loop is visible.
      expect(cycle[0]).toBe(cycle[cycle.length - 1]);
      expect(cycle.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('does not mutate the input array', () => {
    const input = [skill('b', ['a']), skill('a')];
    resolveSkillLoadOrder(input);
    expect(input.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('treats duplicate ids as last-write-wins (silently)', () => {
    const ordered = resolveSkillLoadOrder([skill('a'), skill('a', ['b']), skill('b')]);
    // 'a' depends on 'b' after the override, so 'b' must come first.
    expect(ordered.map((s) => s.id)).toEqual(['b', 'a']);
  });
});
