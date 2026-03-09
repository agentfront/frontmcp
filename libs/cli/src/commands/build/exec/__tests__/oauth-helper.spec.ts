import { generateOAuthHelperSource } from '../cli-runtime/oauth-helper';

describe('generateOAuthHelperSource', () => {
  it('should return valid JavaScript source', () => {
    const source = generateOAuthHelperSource('test-app');
    expect(source).toContain('function findAvailablePort');
    expect(source).toContain('function generateCodeVerifier');
    expect(source).toContain('function generateCodeChallenge');
    expect(source).toContain('function startCallbackServer');
    expect(source).toContain('function exchangeCodeForToken');
    expect(source).toContain('function openBrowser');
    expect(source).toContain('function startOAuthLogin');
    expect(source).toContain('module.exports');
  });

  it('should embed app name in generated source', () => {
    const source = generateOAuthHelperSource('my-mcp-app');
    expect(source).toContain('"my-mcp-app"');
  });

  it('should be evaluable JavaScript', () => {
    const source = generateOAuthHelperSource('test-app');
    expect(() => {
      new Function(source);
    }).not.toThrow();
  });

  it('should use PKCE S256 challenge method', () => {
    const source = generateOAuthHelperSource('test-app');
    expect(source).toContain('sha256');
    expect(source).toContain('base64url');
    expect(source).toContain('code_challenge_method=S256');
  });

  it('should support platform-aware browser opening', () => {
    const source = generateOAuthHelperSource('test-app');
    expect(source).toContain("'darwin'");
    expect(source).toContain("'win32'");
    expect(source).toContain("'xdg-open'");
  });

  it('should handle callback server with code and state', () => {
    const source = generateOAuthHelperSource('test-app');
    expect(source).toContain('/callback');
    expect(source).toContain('parsed.query.code');
    expect(source).toContain('parsed.query.state');
  });

  it('should exchange code for token via POST', () => {
    const source = generateOAuthHelperSource('test-app');
    expect(source).toContain('/oauth/token');
    expect(source).toContain('application/x-www-form-urlencoded');
    expect(source).toContain('grant_type=authorization_code');
  });

  it('should verify state parameter in login flow', () => {
    const source = generateOAuthHelperSource('test-app');
    expect(source).toContain('state mismatch');
  });

  it('should export all required functions', () => {
    const source = generateOAuthHelperSource('test-app');
    expect(source).toContain('findAvailablePort:');
    expect(source).toContain('generateCodeVerifier:');
    expect(source).toContain('generateCodeChallenge:');
    expect(source).toContain('startCallbackServer:');
    expect(source).toContain('exchangeCodeForToken:');
    expect(source).toContain('openBrowser:');
    expect(source).toContain('startOAuthLogin:');
  });

  it('should handle OAuth errors from callback', () => {
    const source = generateOAuthHelperSource('test-app');
    expect(source).toContain('parsed.query.error');
    expect(source).toContain('Authentication Failed');
  });

  it('should support --no-browser mode', () => {
    const source = generateOAuthHelperSource('test-app');
    expect(source).toContain('noBrowser');
    expect(source).toContain('Open this URL in your browser');
  });

  it('should handle token exchange error responses', () => {
    const source = generateOAuthHelperSource('test-app');
    expect(source).toContain('error_description');
    expect(source).toContain('Token exchange failed');
  });
});
