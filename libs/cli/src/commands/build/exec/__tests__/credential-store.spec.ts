import { generateCredentialStoreSource } from '../cli-runtime/credential-store';

describe('generateCredentialStoreSource', () => {
  it('should generate valid JavaScript source', () => {
    const source = generateCredentialStoreSource('my-app');
    expect(source).toContain("var APP_NAME = \"my-app\"");
    expect(source).toContain('function createCredentialStore');
    expect(source).toContain('module.exports');
  });

  it('should embed app name correctly', () => {
    const source = generateCredentialStoreSource('test-server');
    expect(source).toContain('"test-server"');
    expect(source).toContain("'frontmcp.' + APP_NAME");
  });

  it('should include KeychainStore implementation', () => {
    const source = generateCredentialStoreSource('my-app');
    expect(source).toContain('KeychainStore');
    expect(source).toContain('find-generic-password');
    expect(source).toContain('add-generic-password');
    expect(source).toContain('delete-generic-password');
  });

  it('should include FileStore implementation', () => {
    const source = generateCredentialStoreSource('my-app');
    expect(source).toContain('FileStore');
    expect(source).toContain('.enc');
    expect(source).toContain('0o600');
  });

  it('should include encryption functions', () => {
    const source = generateCredentialStoreSource('my-app');
    expect(source).toContain('function encryptBlob');
    expect(source).toContain('function decryptBlob');
    expect(source).toContain('aes-256-gcm');
  });

  it('should detect platform for store selection', () => {
    const source = generateCredentialStoreSource('my-app');
    expect(source).toContain("process.platform === 'darwin'");
    expect(source).toContain('return KeychainStore');
    expect(source).toContain('return FileStore');
  });

  it('should include credential directory path', () => {
    const source = generateCredentialStoreSource('my-app');
    expect(source).toContain('.frontmcp');
    expect(source).toContain('credentials');
  });

  it('should be evaluable JavaScript', () => {
    const source = generateCredentialStoreSource('test');
    expect(() => {
      new Function(source);
    }).not.toThrow();
  });

  it('should handle special characters in app name', () => {
    const source = generateCredentialStoreSource('my.app-v2');
    expect(source).toContain('"my.app-v2"');
  });
});
