import { TestUsers, createTestUser } from '../user-fixtures';
import type { TestUserFixture } from '../user-fixtures';

describe('TestUsers', () => {
  it('should contain all expected user keys', () => {
    const expectedKeys = ['admin', 'user', 'readOnly', 'anonymous', 'noScopes', 'toolsOnly', 'resourcesOnly'];
    expect(Object.keys(TestUsers)).toEqual(expect.arrayContaining(expectedKeys));
    expect(Object.keys(TestUsers)).toHaveLength(expectedKeys.length);
  });

  describe('admin', () => {
    it('should have full admin properties', () => {
      const admin = TestUsers['admin'];
      expect(admin.sub).toBe('admin-001');
      expect(admin.email).toBe('admin@test.local');
      expect(admin.name).toBe('Test Admin');
      expect(admin.scopes).toEqual(['admin:*', 'read', 'write', 'delete']);
      expect(admin.role).toBe('admin');
    });
  });

  describe('user', () => {
    it('should have read/write scopes', () => {
      const user = TestUsers['user'];
      expect(user.sub).toBe('user-001');
      expect(user.email).toBe('user@test.local');
      expect(user.scopes).toEqual(['read', 'write']);
      expect(user.role).toBe('user');
    });
  });

  describe('readOnly', () => {
    it('should have only read scope', () => {
      const readOnly = TestUsers['readOnly'];
      expect(readOnly.sub).toBe('readonly-001');
      expect(readOnly.scopes).toEqual(['read']);
      expect(readOnly.role).toBe('readonly');
    });
  });

  describe('anonymous', () => {
    it('should have anonymous scope and no email', () => {
      const anon = TestUsers['anonymous'];
      expect(anon.sub).toBe('anon:001');
      expect(anon.email).toBeUndefined();
      expect(anon.scopes).toEqual(['anonymous']);
      expect(anon.role).toBe('anonymous');
    });
  });

  describe('noScopes', () => {
    it('should have empty scopes array', () => {
      const noScopes = TestUsers['noScopes'];
      expect(noScopes.sub).toBe('noscopes-001');
      expect(noScopes.scopes).toEqual([]);
      expect(noScopes.role).toBe('user');
    });
  });

  describe('toolsOnly', () => {
    it('should have only tools:execute scope', () => {
      const toolsOnly = TestUsers['toolsOnly'];
      expect(toolsOnly.sub).toBe('toolsonly-001');
      expect(toolsOnly.scopes).toEqual(['tools:execute']);
    });
  });

  describe('resourcesOnly', () => {
    it('should have only resources:read scope', () => {
      const resourcesOnly = TestUsers['resourcesOnly'];
      expect(resourcesOnly.sub).toBe('resourcesonly-001');
      expect(resourcesOnly.scopes).toEqual(['resources:read']);
    });
  });

  it('every user fixture should have sub and scopes', () => {
    for (const [key, fixture] of Object.entries(TestUsers)) {
      expect(fixture.sub).toBeDefined();
      expect(Array.isArray(fixture.scopes)).toBe(true);
    }
  });
});

describe('createTestUser', () => {
  it('should create a user with just sub, defaulting scopes to empty', () => {
    const user = createTestUser({ sub: 'custom-001' });
    expect(user.sub).toBe('custom-001');
    expect(user.scopes).toEqual([]);
    expect(user.email).toBeUndefined();
    expect(user.name).toBeUndefined();
    expect(user.role).toBeUndefined();
  });

  it('should allow overriding all properties', () => {
    const user = createTestUser({
      sub: 'custom-002',
      email: 'custom@test.local',
      name: 'Custom User',
      scopes: ['read', 'admin:*'],
      role: 'admin',
    });
    expect(user.sub).toBe('custom-002');
    expect(user.email).toBe('custom@test.local');
    expect(user.name).toBe('Custom User');
    expect(user.scopes).toEqual(['read', 'admin:*']);
    expect(user.role).toBe('admin');
  });

  it('should use provided scopes instead of default empty array', () => {
    const user = createTestUser({ sub: 'custom-003', scopes: ['write'] });
    expect(user.scopes).toEqual(['write']);
  });

  it('should return a plain object conforming to TestUserFixture', () => {
    const user: TestUserFixture = createTestUser({ sub: 'type-check-001' });
    expect(user).toBeDefined();
  });

  it('should return isolated scopes arrays per call (mutation safety)', () => {
    const userA = createTestUser({ sub: 'iso-a' });
    const userB = createTestUser({ sub: 'iso-b' });
    userA.scopes.push('mutated');
    expect(userA.scopes).toEqual(['mutated']);
    expect(userB.scopes).toEqual([]);
  });
});
