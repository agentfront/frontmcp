/**
 * Templates Tests
 */
import {
  buildConsentPage,
  buildIncrementalAuthPage,
  buildFederatedLoginPage,
  buildToolConsentPage,
  buildLoginPage,
  buildErrorPage,
  renderToHtml,
  escapeHtml,
  AppAuthCard,
  ProviderCard,
  ToolCard,
} from '../templates';

describe('escapeHtml (re-export)', () => {
  it('should escape HTML characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });
});

describe('buildConsentPage', () => {
  const defaultParams = {
    apps: [
      {
        appId: 'app1',
        appName: 'Test App',
        description: 'A test application',
        requiredScopes: ['read', 'write'],
      } as AppAuthCard,
    ],
    clientName: 'Test Client',
    pendingAuthId: 'pending-123',
    csrfToken: 'csrf-token-456',
    callbackPath: '/oauth/callback',
  };

  it('should generate valid HTML', () => {
    const html = buildConsentPage(defaultParams);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('should include client name in title', () => {
    const html = buildConsentPage(defaultParams);

    expect(html).toContain('Authorize Test Client');
  });

  it('should include app name', () => {
    const html = buildConsentPage(defaultParams);

    expect(html).toContain('Test App');
  });

  it('should include app description', () => {
    const html = buildConsentPage(defaultParams);

    expect(html).toContain('A test application');
  });

  it('should include required scopes', () => {
    const html = buildConsentPage(defaultParams);

    expect(html).toContain('read');
    expect(html).toContain('write');
  });

  it('should include CSRF token in form', () => {
    const html = buildConsentPage(defaultParams);

    expect(html).toContain('name="csrf"');
    expect(html).toContain('value="csrf-token-456"');
  });

  it('should include pending auth ID in form', () => {
    const html = buildConsentPage(defaultParams);

    expect(html).toContain('name="pending_auth_id"');
    expect(html).toContain('value="pending-123"');
  });

  it('should include authorize and skip buttons', () => {
    const html = buildConsentPage(defaultParams);

    expect(html).toContain('value="authorize"');
    expect(html).toContain('value="skip"');
  });

  it('should include callback path in form action', () => {
    const html = buildConsentPage(defaultParams);

    expect(html).toContain('action="/oauth/callback"');
  });

  it('should escape XSS in client name', () => {
    const html = buildConsentPage({
      ...defaultParams,
      clientName: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should show app icon if provided', () => {
    const html = buildConsentPage({
      ...defaultParams,
      apps: [
        {
          appId: 'app1',
          appName: 'Test App',
          iconUrl: 'https://example.com/icon.png',
        },
      ],
    });

    expect(html).toContain('https://example.com/icon.png');
    expect(html).toContain('<img');
  });

  it('should show initial letter fallback when no icon', () => {
    const html = buildConsentPage(defaultParams);

    expect(html).toContain('>T</div>'); // First letter of "Test App"
  });

  it('should handle multiple apps', () => {
    const html = buildConsentPage({
      ...defaultParams,
      apps: [
        { appId: 'app1', appName: 'First App' },
        { appId: 'app2', appName: 'Second App' },
        { appId: 'app3', appName: 'Third App' },
      ],
    });

    expect(html).toContain('First App');
    expect(html).toContain('Second App');
    expect(html).toContain('Third App');
  });

  it('should escape XSS in app name', () => {
    const html = buildConsentPage({
      ...defaultParams,
      apps: [{ ...defaultParams.apps[0], appName: '<script>alert("xss")</script>' }],
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in app description', () => {
    const html = buildConsentPage({
      ...defaultParams,
      apps: [{ ...defaultParams.apps[0], description: '<script>alert("xss")</script>' }],
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in required scopes', () => {
    const html = buildConsentPage({
      ...defaultParams,
      apps: [{ ...defaultParams.apps[0], requiredScopes: ['<script>alert("xss")</script>'] }],
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildIncrementalAuthPage', () => {
  const defaultParams = {
    app: {
      appId: 'app1',
      appName: 'Test App',
      description: 'Test description',
    } as AppAuthCard,
    toolId: 'test_tool',
    sessionHint: 'session-123',
    callbackPath: '/oauth/incremental',
  };

  it('should generate valid HTML', () => {
    const html = buildIncrementalAuthPage(defaultParams);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('should show authorization required message', () => {
    const html = buildIncrementalAuthPage(defaultParams);

    expect(html).toContain('Authorization Required');
  });

  it('should include tool ID', () => {
    const html = buildIncrementalAuthPage(defaultParams);

    expect(html).toContain('test_tool');
  });

  it('should include app name', () => {
    const html = buildIncrementalAuthPage(defaultParams);

    expect(html).toContain('Test App');
  });

  it('should include session hint in form', () => {
    const html = buildIncrementalAuthPage(defaultParams);

    expect(html).toContain('name="pending_auth_id"');
    expect(html).toContain('value="session-123"');
  });

  it('should include incremental flag', () => {
    const html = buildIncrementalAuthPage(defaultParams);

    expect(html).toContain('name="incremental"');
    expect(html).toContain('value="true"');
  });

  it('should have cancel and authorize buttons', () => {
    const html = buildIncrementalAuthPage(defaultParams);

    expect(html).toContain('Cancel');
    expect(html).toContain('Authorize');
  });

  it('should use centered card layout', () => {
    const html = buildIncrementalAuthPage(defaultParams);

    expect(html).toContain('flex items-center justify-center');
  });

  it('should escape XSS in app name', () => {
    const html = buildIncrementalAuthPage({
      ...defaultParams,
      app: { ...defaultParams.app, appName: '<script>alert("xss")</script>' },
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in app description', () => {
    const html = buildIncrementalAuthPage({
      ...defaultParams,
      app: { ...defaultParams.app, description: '<script>alert("xss")</script>' },
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in tool ID', () => {
    const html = buildIncrementalAuthPage({
      ...defaultParams,
      toolId: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildFederatedLoginPage', () => {
  const defaultParams = {
    providers: [
      {
        providerId: 'github',
        providerName: 'GitHub',
        mode: 'transparent',
        appIds: ['app1'],
        isPrimary: true,
      } as ProviderCard,
    ],
    clientName: 'Test Client',
    pendingAuthId: 'pending-123',
    callbackPath: '/oauth/federated',
  };

  it('should generate valid HTML', () => {
    const html = buildFederatedLoginPage(defaultParams);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('should include provider name', () => {
    const html = buildFederatedLoginPage(defaultParams);

    expect(html).toContain('GitHub');
  });

  it('should show primary badge for primary provider', () => {
    const html = buildFederatedLoginPage(defaultParams);

    expect(html).toContain('Primary');
  });

  it('should show mode', () => {
    const html = buildFederatedLoginPage(defaultParams);

    expect(html).toContain('Mode: transparent');
  });

  it('should show app IDs', () => {
    const html = buildFederatedLoginPage(defaultParams);

    expect(html).toContain('Apps: app1');
  });

  it('should include select all checkbox', () => {
    const html = buildFederatedLoginPage(defaultParams);

    expect(html).toContain('id="select-all"');
    expect(html).toContain('Select all providers');
  });

  it('should include email input', () => {
    const html = buildFederatedLoginPage(defaultParams);

    expect(html).toContain('type="email"');
    expect(html).toContain('name="email"');
  });

  it('should have Skip All and Continue buttons', () => {
    const html = buildFederatedLoginPage(defaultParams);

    expect(html).toContain('Skip All');
    expect(html).toContain('Continue');
  });

  it('should pre-check primary provider', () => {
    const html = buildFederatedLoginPage(defaultParams);

    expect(html).toContain('checked');
  });

  it('should handle multiple providers', () => {
    const html = buildFederatedLoginPage({
      ...defaultParams,
      providers: [
        { providerId: 'github', providerName: 'GitHub', mode: 'transparent', appIds: [], isPrimary: true },
        { providerId: 'google', providerName: 'Google', mode: 'local', appIds: [] },
      ],
    });

    expect(html).toContain('GitHub');
    expect(html).toContain('Google');
  });

  it('should show provider URL when provided', () => {
    const html = buildFederatedLoginPage({
      ...defaultParams,
      providers: [
        {
          providerId: 'custom',
          providerName: 'Custom Provider',
          providerUrl: 'https://auth.custom.com',
          mode: 'remote',
          appIds: [],
        },
      ],
    });

    expect(html).toContain('https://auth.custom.com');
  });

  it('should escape XSS in provider name', () => {
    const html = buildFederatedLoginPage({
      ...defaultParams,
      providers: [{ ...defaultParams.providers[0], providerName: '<script>alert("xss")</script>' }],
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in provider URL', () => {
    const html = buildFederatedLoginPage({
      ...defaultParams,
      providers: [{ ...defaultParams.providers[0], providerUrl: '<script>alert("xss")</script>' }],
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in app IDs', () => {
    const html = buildFederatedLoginPage({
      ...defaultParams,
      providers: [{ ...defaultParams.providers[0], appIds: ['<script>alert("xss")</script>'] }],
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in client name', () => {
    const html = buildFederatedLoginPage({
      ...defaultParams,
      clientName: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildToolConsentPage', () => {
  const defaultParams = {
    tools: [
      {
        toolId: 'tool1',
        toolName: 'Create Issue',
        description: 'Creates a GitHub issue',
        appId: 'github',
        appName: 'GitHub',
      } as ToolCard,
    ],
    clientName: 'Test Client',
    pendingAuthId: 'pending-123',
    csrfToken: 'csrf-456',
    callbackPath: '/oauth/tools',
  };

  it('should generate valid HTML', () => {
    const html = buildToolConsentPage(defaultParams);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('should include page title', () => {
    const html = buildToolConsentPage(defaultParams);

    expect(html).toContain('Select Tools to Enable');
  });

  it('should include tool name', () => {
    const html = buildToolConsentPage(defaultParams);

    expect(html).toContain('Create Issue');
  });

  it('should include tool description', () => {
    const html = buildToolConsentPage(defaultParams);

    expect(html).toContain('Creates a GitHub issue');
  });

  it('should group tools by app', () => {
    const html = buildToolConsentPage(defaultParams);

    expect(html).toContain('GitHub');
  });

  it('should include select all checkbox', () => {
    const html = buildToolConsentPage(defaultParams);

    expect(html).toContain('id="select-all"');
    expect(html).toContain('Select all tools');
  });

  it('should include toggle all button per app', () => {
    const html = buildToolConsentPage(defaultParams);

    expect(html).toContain('Toggle All');
  });

  it('should show selection count', () => {
    const html = buildToolConsentPage(defaultParams);

    expect(html).toContain('1 of 1 selected');
  });

  it('should have Cancel and Confirm buttons', () => {
    const html = buildToolConsentPage(defaultParams);

    expect(html).toContain('Cancel');
    expect(html).toContain('Confirm Selection');
  });

  it('should show user info when provided', () => {
    const html = buildToolConsentPage({
      ...defaultParams,
      userName: 'John Doe',
      userEmail: 'john@example.com',
    });

    expect(html).toContain('Signed in as');
    expect(html).toContain('John Doe');
  });

  it('should show email when userName not provided', () => {
    const html = buildToolConsentPage({
      ...defaultParams,
      userEmail: 'john@example.com',
    });

    expect(html).toContain('john@example.com');
  });

  it('should handle multiple tools from same app', () => {
    const html = buildToolConsentPage({
      ...defaultParams,
      tools: [
        { toolId: 'tool1', toolName: 'Tool One', appId: 'app1', appName: 'App' },
        { toolId: 'tool2', toolName: 'Tool Two', appId: 'app1', appName: 'App' },
      ],
    });

    expect(html).toContain('Tool One');
    expect(html).toContain('Tool Two');
    expect(html).toContain('2 of 2 selected');
  });

  it('should handle tools from multiple apps', () => {
    const html = buildToolConsentPage({
      ...defaultParams,
      tools: [
        { toolId: 'tool1', toolName: 'GitHub Tool', appId: 'github', appName: 'GitHub' },
        { toolId: 'tool2', toolName: 'Slack Tool', appId: 'slack', appName: 'Slack' },
      ],
    });

    expect(html).toContain('GitHub');
    expect(html).toContain('Slack');
  });

  it('should escape XSS in tool name', () => {
    const html = buildToolConsentPage({
      ...defaultParams,
      tools: [{ ...defaultParams.tools[0], toolName: '<script>alert("xss")</script>' }],
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in tool description', () => {
    const html = buildToolConsentPage({
      ...defaultParams,
      tools: [{ ...defaultParams.tools[0], description: '<script>alert("xss")</script>' }],
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in app name', () => {
    const html = buildToolConsentPage({
      ...defaultParams,
      tools: [{ ...defaultParams.tools[0], appName: '<script>alert("xss")</script>' }],
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in user name', () => {
    const html = buildToolConsentPage({
      ...defaultParams,
      userName: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in user email', () => {
    const html = buildToolConsentPage({
      ...defaultParams,
      userEmail: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildLoginPage', () => {
  const defaultParams = {
    clientName: 'Test Client',
    scope: 'openid profile email',
    pendingAuthId: 'pending-123',
    callbackPath: '/oauth/login',
  };

  it('should generate valid HTML', () => {
    const html = buildLoginPage(defaultParams);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('should include Sign In title', () => {
    const html = buildLoginPage(defaultParams);

    expect(html).toContain('Sign In');
  });

  it('should include client name', () => {
    const html = buildLoginPage(defaultParams);

    expect(html).toContain('Test Client');
  });

  it('should show requested scopes', () => {
    const html = buildLoginPage(defaultParams);

    expect(html).toContain('openid');
    expect(html).toContain('profile');
    expect(html).toContain('email');
  });

  it('should include email input', () => {
    const html = buildLoginPage(defaultParams);

    expect(html).toContain('type="email"');
    expect(html).toContain('id="email"');
    expect(html).toContain('name="email"');
    expect(html).toContain('required');
  });

  it('should include optional name input', () => {
    const html = buildLoginPage(defaultParams);

    expect(html).toContain('type="text"');
    expect(html).toContain('id="name"');
    expect(html).toContain('name="name"');
    expect(html).toContain('(optional)');
  });

  it('should include pending auth ID', () => {
    const html = buildLoginPage(defaultParams);

    expect(html).toContain('name="pending_auth_id"');
    expect(html).toContain('value="pending-123"');
  });

  it('should have Authorize button', () => {
    const html = buildLoginPage(defaultParams);

    expect(html).toContain('Authorize');
    expect(html).toMatch(/<button[^>]*>[\s\S]*Authorize[\s\S]*<\/button>/);
  });

  it('should handle empty scope', () => {
    const html = buildLoginPage({
      ...defaultParams,
      scope: '',
    });

    // Should not crash, should still be valid HTML
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('should use centered card layout', () => {
    const html = buildLoginPage(defaultParams);

    expect(html).toContain('flex items-center justify-center');
  });

  it('should escape XSS in client name', () => {
    const html = buildLoginPage({
      ...defaultParams,
      clientName: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in scope', () => {
    const html = buildLoginPage({
      ...defaultParams,
      scope: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildErrorPage', () => {
  const defaultParams = {
    error: 'access_denied',
    description: 'The user denied the authorization request.',
  };

  it('should generate valid HTML', () => {
    const html = buildErrorPage(defaultParams);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('should show Authorization Error title', () => {
    const html = buildErrorPage(defaultParams);

    expect(html).toContain('Authorization Error');
  });

  it('should show error code', () => {
    const html = buildErrorPage(defaultParams);

    expect(html).toContain('access_denied');
  });

  it('should show error description', () => {
    const html = buildErrorPage(defaultParams);

    expect(html).toContain('The user denied the authorization request.');
  });

  it('should escape XSS in error', () => {
    const html = buildErrorPage({
      error: '<script>alert("xss")</script>',
      description: 'Test',
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape XSS in description', () => {
    const html = buildErrorPage({
      error: 'error',
      description: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should use centered card layout', () => {
    const html = buildErrorPage(defaultParams);

    expect(html).toContain('flex items-center justify-center');
  });

  it('should show error icon', () => {
    const html = buildErrorPage(defaultParams);

    expect(html).toContain('<svg');
    expect(html).toContain('text-red-600');
  });
});

describe('renderToHtml', () => {
  it('should return input unchanged', () => {
    const input = '<html><body>Content</body></html>';
    const result = renderToHtml(input);

    expect(result).toBe(input);
  });

  it('should ignore options', () => {
    const input = '<html><body>Content</body></html>';
    const result = renderToHtml(input, { title: 'Ignored' });

    expect(result).toBe(input);
  });
});
