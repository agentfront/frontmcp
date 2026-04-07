import { AuthoritiesProfileRegistry, AuthoritiesEvaluatorRegistry } from '../authorities.registry';
import type { AuthoritiesEvaluator } from '../authorities.types';

describe('AuthoritiesProfileRegistry', () => {
  let registry: AuthoritiesProfileRegistry;

  beforeEach(() => {
    registry = new AuthoritiesProfileRegistry();
  });

  it('should register and resolve a profile', () => {
    registry.register('admin', { roles: { any: ['admin'] } });
    const policy = registry.resolve('admin');
    expect(policy).toEqual({ roles: { any: ['admin'] } });
  });

  it('should return undefined for unregistered profile', () => {
    expect(registry.resolve('unknown')).toBeUndefined();
  });

  it('should overwrite existing profile on re-register', () => {
    registry.register('admin', { roles: { any: ['admin'] } });
    registry.register('admin', { roles: { all: ['superadmin'] } });
    expect(registry.resolve('admin')).toEqual({ roles: { all: ['superadmin'] } });
  });

  it('should register multiple profiles at once', () => {
    registry.registerAll({
      admin: { roles: { any: ['admin'] } },
      user: { attributes: { conditions: [{ path: 'user.sub', op: 'exists', value: true }] } },
    });
    expect(registry.has('admin')).toBe(true);
    expect(registry.has('user')).toBe(true);
    expect(registry.size).toBe(2);
  });

  it('should get all profiles', () => {
    registry.register('a', { roles: { any: ['a'] } });
    registry.register('b', { roles: { any: ['b'] } });
    const all = registry.getAll();
    expect(Object.keys(all)).toEqual(['a', 'b']);
  });

  it('should remove a profile', () => {
    registry.register('admin', { roles: { any: ['admin'] } });
    expect(registry.remove('admin')).toBe(true);
    expect(registry.has('admin')).toBe(false);
  });

  it('should return false when removing non-existent profile', () => {
    expect(registry.remove('nonexistent')).toBe(false);
  });

  it('should clear all profiles', () => {
    registry.register('a', { roles: { any: ['a'] } });
    registry.register('b', { roles: { any: ['b'] } });
    registry.clear();
    expect(registry.size).toBe(0);
  });
});

describe('AuthoritiesEvaluatorRegistry', () => {
  let registry: AuthoritiesEvaluatorRegistry;

  const mockEvaluator: AuthoritiesEvaluator = {
    name: 'test',
    evaluate: async () => ({ granted: true, evaluatedPolicies: ['custom.test'] }),
  };

  beforeEach(() => {
    registry = new AuthoritiesEvaluatorRegistry();
  });

  it('should register and get an evaluator', () => {
    registry.register('test', mockEvaluator);
    expect(registry.get('test')).toBe(mockEvaluator);
  });

  it('should return undefined for unregistered evaluator', () => {
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('should check existence', () => {
    registry.register('test', mockEvaluator);
    expect(registry.has('test')).toBe(true);
    expect(registry.has('other')).toBe(false);
  });

  it('should register multiple evaluators at once', () => {
    const eval2: AuthoritiesEvaluator = {
      name: 'other',
      evaluate: async () => ({ granted: false, evaluatedPolicies: [], deniedBy: 'denied' }),
    };
    registry.registerAll({ test: mockEvaluator, other: eval2 });
    expect(registry.size).toBe(2);
  });

  it('should remove an evaluator', () => {
    registry.register('test', mockEvaluator);
    expect(registry.remove('test')).toBe(true);
    expect(registry.has('test')).toBe(false);
  });

  it('should clear all evaluators', () => {
    registry.register('a', mockEvaluator);
    registry.register('b', mockEvaluator);
    registry.clear();
    expect(registry.size).toBe(0);
  });
});
