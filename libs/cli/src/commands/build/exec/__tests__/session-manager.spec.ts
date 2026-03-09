import { generateSessionManagerSource } from '../cli-runtime/session-manager';

describe('generateSessionManagerSource', () => {
  it('should generate valid JavaScript source', () => {
    const source = generateSessionManagerSource('my-app');
    expect(source).toContain("var APP_NAME = \"my-app\"");
    expect(source).toContain('module.exports');
  });

  it('should export all session management functions', () => {
    const source = generateSessionManagerSource('my-app');
    expect(source).toContain('getOrCreateSession');
    expect(source).toContain('touchSession');
    expect(source).toContain('listSessions');
    expect(source).toContain('deleteSession');
    expect(source).toContain('switchSession');
    expect(source).toContain('getActiveSessionName');
  });

  it('should use correct session directory path', () => {
    const source = generateSessionManagerSource('test-server');
    expect(source).toContain('.frontmcp');
    expect(source).toContain('sessions');
    expect(source).toContain('"test-server"');
  });

  it('should include active session tracking via .active file', () => {
    const source = generateSessionManagerSource('my-app');
    expect(source).toContain('.active');
    expect(source).toContain('getActiveSessionName');
    expect(source).toContain('setActiveSession');
  });

  it('should create session with metadata fields', () => {
    const source = generateSessionManagerSource('my-app');
    expect(source).toContain('createdAt');
    expect(source).toContain('lastUsedAt');
    expect(source).toContain('isActive');
  });

  it('should use 0o600 permissions for session files', () => {
    const source = generateSessionManagerSource('my-app');
    expect(source).toContain('0o600');
  });

  it('should default to "default" session name', () => {
    const source = generateSessionManagerSource('my-app');
    expect(source).toContain("'default'");
  });

  it('should be evaluable JavaScript', () => {
    const source = generateSessionManagerSource('test');
    expect(() => {
      new Function(source);
    }).not.toThrow();
  });

  it('should handle app names with dots and dashes', () => {
    const source = generateSessionManagerSource('my.app-v2');
    expect(source).toContain('"my.app-v2"');
  });
});
