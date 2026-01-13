/**
 * Templates Advanced Tests
 *
 * Additional edge case tests for OAuth UI templates.
 */
import {
  buildConsentPage,
  buildIncrementalAuthPage,
  buildFederatedLoginPage,
  buildToolConsentPage,
  buildLoginPage,
  buildErrorPage,
  AppAuthCard,
  ProviderCard,
  ToolCard,
} from '../templates';

describe('Template Edge Cases', () => {
  describe('buildConsentPage edge cases', () => {
    it('should handle app with no scopes', () => {
      const html = buildConsentPage({
        apps: [{ appId: 'app1', appName: 'No Scopes App' }],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        csrfToken: 'csrf-456',
        callbackPath: '/callback',
      });

      expect(html).toContain('No Scopes App');
      expect(html).not.toContain('Permissions');
    });

    it('should handle app with empty scopes array', () => {
      const html = buildConsentPage({
        apps: [{ appId: 'app1', appName: 'Empty Scopes', requiredScopes: [] }],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        csrfToken: 'csrf-456',
        callbackPath: '/callback',
      });

      expect(html).toContain('Empty Scopes');
      expect(html).not.toContain('Permissions');
    });

    it('should handle many apps', () => {
      const apps: AppAuthCard[] = [];
      for (let i = 0; i < 10; i++) {
        apps.push({
          appId: `app-${i}`,
          appName: `Application ${i}`,
          description: `Description for app ${i}`,
          requiredScopes: [`scope-${i}`],
        });
      }

      const html = buildConsentPage({
        apps,
        clientName: 'Multi-App Client',
        pendingAuthId: 'pending-123',
        csrfToken: 'csrf-456',
        callbackPath: '/callback',
      });

      for (let i = 0; i < 10; i++) {
        expect(html).toContain(`Application ${i}`);
        expect(html).toContain(`app-${i}`);
      }
    });

    it('should escape special characters in app data', () => {
      const html = buildConsentPage({
        apps: [
          {
            appId: 'app<1>',
            appName: '<script>App</script>',
            description: 'Description with "quotes" & ampersand',
            requiredScopes: ['<scope>'],
          },
        ],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        csrfToken: 'csrf-456',
        callbackPath: '/callback',
      });

      expect(html).not.toContain('<script>App</script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&quot;quotes&quot;');
      expect(html).toContain('&amp;');
    });

    it('should handle app with very long name', () => {
      const longName = 'A'.repeat(200);
      const html = buildConsentPage({
        apps: [{ appId: 'app1', appName: longName }],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        csrfToken: 'csrf-456',
        callbackPath: '/callback',
      });

      expect(html).toContain(longName);
    });
  });

  describe('buildIncrementalAuthPage edge cases', () => {
    it('should handle app without description', () => {
      const html = buildIncrementalAuthPage({
        app: { appId: 'app1', appName: 'No Desc App' },
        toolId: 'tool_1',
        sessionHint: 'session-123',
        callbackPath: '/callback',
      });

      expect(html).toContain('No Desc App');
      expect(html).toContain('tool_1');
    });

    it('should escape XSS in tool ID', () => {
      const html = buildIncrementalAuthPage({
        app: { appId: 'app1', appName: 'App' },
        toolId: '<script>alert(1)</script>',
        sessionHint: 'session-123',
        callbackPath: '/callback',
      });

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('buildFederatedLoginPage edge cases', () => {
    it('should handle provider without URL', () => {
      const html = buildFederatedLoginPage({
        providers: [
          {
            providerId: 'local',
            providerName: 'Local Provider',
            mode: 'local',
            appIds: [],
          },
        ],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        callbackPath: '/callback',
      });

      expect(html).toContain('Local Provider');
      expect(html).toContain('Mode: local');
    });

    it('should handle provider with empty appIds', () => {
      const html = buildFederatedLoginPage({
        providers: [
          {
            providerId: 'empty',
            providerName: 'Empty Apps Provider',
            mode: 'transparent',
            appIds: [],
          },
        ],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        callbackPath: '/callback',
      });

      expect(html).toContain('Empty Apps Provider');
      expect(html).not.toContain('Apps:');
    });

    it('should handle provider with multiple appIds', () => {
      const html = buildFederatedLoginPage({
        providers: [
          {
            providerId: 'multi',
            providerName: 'Multi App Provider',
            mode: 'orchestrated',
            appIds: ['app1', 'app2', 'app3'],
          },
        ],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        callbackPath: '/callback',
      });

      expect(html).toContain('app1, app2, app3');
    });

    it('should handle many providers', () => {
      const providers: ProviderCard[] = [];
      for (let i = 0; i < 5; i++) {
        providers.push({
          providerId: `provider-${i}`,
          providerName: `Provider ${i}`,
          mode: i % 2 === 0 ? 'transparent' : 'orchestrated',
          appIds: [`app-${i}`],
          isPrimary: i === 0,
        });
      }

      const html = buildFederatedLoginPage({
        providers,
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        callbackPath: '/callback',
      });

      for (let i = 0; i < 5; i++) {
        expect(html).toContain(`Provider ${i}`);
      }
    });

    it('should not mark non-primary provider as checked', () => {
      const html = buildFederatedLoginPage({
        providers: [
          {
            providerId: 'secondary',
            providerName: 'Secondary Provider',
            mode: 'transparent',
            appIds: [],
            isPrimary: false,
          },
        ],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        callbackPath: '/callback',
      });

      // The provider checkbox should not be pre-checked
      expect(html).toContain('value="secondary"');
      // Should not have 'checked' attribute right after the value
      expect(html).not.toMatch(/value="secondary"[^>]*checked/);
    });
  });

  describe('buildToolConsentPage edge cases', () => {
    it('should handle tools without description', () => {
      const html = buildToolConsentPage({
        tools: [
          {
            toolId: 'tool1',
            toolName: 'No Desc Tool',
            appId: 'app1',
            appName: 'App',
          },
        ],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        csrfToken: 'csrf-456',
        callbackPath: '/callback',
      });

      expect(html).toContain('No Desc Tool');
    });

    it('should not show user info when not provided', () => {
      const html = buildToolConsentPage({
        tools: [{ toolId: 't1', toolName: 'Tool', appId: 'a1', appName: 'App' }],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        csrfToken: 'csrf-456',
        callbackPath: '/callback',
      });

      expect(html).not.toContain('Signed in as');
    });

    it('should handle tools from many apps', () => {
      const tools: ToolCard[] = [];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) {
          tools.push({
            toolId: `tool-${i}-${j}`,
            toolName: `Tool ${j} of App ${i}`,
            appId: `app-${i}`,
            appName: `Application ${i}`,
          });
        }
      }

      const html = buildToolConsentPage({
        tools,
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        csrfToken: 'csrf-456',
        callbackPath: '/callback',
      });

      // Should show 3 app groups
      expect(html).toContain('Application 0');
      expect(html).toContain('Application 1');
      expect(html).toContain('Application 2');
      // Should show correct count
      expect(html).toContain('6 of 6 selected');
    });

    it('should escape XSS in user name', () => {
      const html = buildToolConsentPage({
        tools: [{ toolId: 't1', toolName: 'Tool', appId: 'a1', appName: 'App' }],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        csrfToken: 'csrf-456',
        callbackPath: '/callback',
        userName: '<script>alert("xss")</script>',
      });

      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should escape XSS in user email', () => {
      const html = buildToolConsentPage({
        tools: [{ toolId: 't1', toolName: 'Tool', appId: 'a1', appName: 'App' }],
        clientName: 'Client',
        pendingAuthId: 'pending-123',
        csrfToken: 'csrf-456',
        callbackPath: '/callback',
        userEmail: '"><script>alert(1)</script>',
      });

      expect(html).not.toContain('<script>alert(1)</script>');
    });
  });

  describe('buildLoginPage edge cases', () => {
    it('should handle scope with special characters', () => {
      const html = buildLoginPage({
        clientName: 'Client',
        scope: 'openid profile:read user:email',
        pendingAuthId: 'pending-123',
        callbackPath: '/callback',
      });

      expect(html).toContain('openid');
      expect(html).toContain('profile:read');
      expect(html).toContain('user:email');
    });

    it('should handle very long scope', () => {
      const longScope = Array(20)
        .fill('scope')
        .map((s, i) => `${s}${i}`)
        .join(' ');
      const html = buildLoginPage({
        clientName: 'Client',
        scope: longScope,
        pendingAuthId: 'pending-123',
        callbackPath: '/callback',
      });

      expect(html).toContain('scope0');
      expect(html).toContain('scope19');
    });

    it('should escape XSS in client name', () => {
      const html = buildLoginPage({
        clientName: '<img src=x onerror=alert(1)>',
        scope: 'openid',
        pendingAuthId: 'pending-123',
        callbackPath: '/callback',
      });

      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).toContain('&lt;img');
    });
  });

  describe('buildErrorPage edge cases', () => {
    it('should handle empty error', () => {
      const html = buildErrorPage({
        error: '',
        description: 'Something went wrong',
      });

      expect(html).toContain('Authorization Error');
      expect(html).toContain('Something went wrong');
    });

    it('should handle empty description', () => {
      const html = buildErrorPage({
        error: 'access_denied',
        description: '',
      });

      expect(html).toContain('access_denied');
    });

    it('should handle long error code', () => {
      const longError = 'error_' + 'x'.repeat(100);
      const html = buildErrorPage({
        error: longError,
        description: 'Test',
      });

      expect(html).toContain(longError);
    });

    it('should handle multi-line description', () => {
      const html = buildErrorPage({
        error: 'error',
        description: 'Line 1\nLine 2\nLine 3',
      });

      // HTML escaping should handle newlines
      expect(html).toContain('Line 1');
    });

    it('should escape HTML entities in error codes', () => {
      const html = buildErrorPage({
        error: 'error&code<>',
        description: 'Test',
      });

      expect(html).toContain('error&amp;code&lt;&gt;');
    });
  });
});

describe('Layout variations', () => {
  it('buildConsentPage uses wideLayout', () => {
    const html = buildConsentPage({
      apps: [{ appId: 'a1', appName: 'App' }],
      clientName: 'Client',
      pendingAuthId: 'p1',
      csrfToken: 'c1',
      callbackPath: '/cb',
    });

    expect(html).toContain('max-w-2xl');
  });

  it('buildIncrementalAuthPage uses centeredCardLayout', () => {
    const html = buildIncrementalAuthPage({
      app: { appId: 'a1', appName: 'App' },
      toolId: 't1',
      sessionHint: 's1',
      callbackPath: '/cb',
    });

    expect(html).toContain('flex items-center justify-center');
    expect(html).toContain('max-w-md');
  });

  it('buildToolConsentPage uses extraWideLayout', () => {
    const html = buildToolConsentPage({
      tools: [{ toolId: 't1', toolName: 'Tool', appId: 'a1', appName: 'App' }],
      clientName: 'Client',
      pendingAuthId: 'p1',
      csrfToken: 'c1',
      callbackPath: '/cb',
    });

    expect(html).toContain('max-w-3xl');
  });

  it('buildLoginPage uses centeredCardLayout', () => {
    const html = buildLoginPage({
      clientName: 'Client',
      scope: 'openid',
      pendingAuthId: 'p1',
      callbackPath: '/cb',
    });

    expect(html).toContain('flex items-center justify-center');
  });

  it('buildErrorPage uses centeredCardLayout', () => {
    const html = buildErrorPage({
      error: 'error',
      description: 'desc',
    });

    expect(html).toContain('flex items-center justify-center');
  });
});
