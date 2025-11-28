/**
 * HTMX Templates Tests
 *
 * Tests for the OAuth UI template builders using HTMX.
 */

import {
  buildConsentPage,
  buildIncrementalAuthPage,
  buildFederatedLoginPage,
  buildToolConsentPage,
  buildLoginPage,
  buildErrorPage,
  escapeHtml,
  type AppAuthCard,
  type ProviderCard,
  type ToolCard,
} from '../htmx-templates';

describe('HTMX Templates', () => {
  // ============================================
  // Utility Functions Tests
  // ============================================

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(escapeHtml('&')).toBe('&amp;');
      expect(escapeHtml('"')).toBe('&quot;');
      expect(escapeHtml("'")).toBe('&#39;');
    });

    it('should handle strings without special characters', () => {
      expect(escapeHtml('hello world')).toBe('hello world');
    });

    it('should handle empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  // ============================================
  // Common HTML Structure Tests
  // ============================================

  describe('Common HTML Structure', () => {
    it('should include DOCTYPE and html tag', () => {
      const html = buildLoginPage({
        clientName: 'Test',
        scope: '',
        pendingAuthId: 'pending',
        callbackPath: '/callback',
      });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include Tailwind CDN', () => {
      const html = buildLoginPage({
        clientName: 'Test',
        scope: '',
        pendingAuthId: 'pending',
        callbackPath: '/callback',
      });

      expect(html).toContain('@tailwindcss/browser');
    });

    it('should include HTMX CDN', () => {
      const html = buildLoginPage({
        clientName: 'Test',
        scope: '',
        pendingAuthId: 'pending',
        callbackPath: '/callback',
      });

      expect(html).toContain('htmx.org');
    });

    it('should include Google Fonts', () => {
      const html = buildLoginPage({
        clientName: 'Test',
        scope: '',
        pendingAuthId: 'pending',
        callbackPath: '/callback',
      });

      expect(html).toContain('fonts.googleapis.com');
      expect(html).toContain('fonts.gstatic.com');
      expect(html).toContain('Inter');
    });

    it('should include viewport meta tag', () => {
      const html = buildLoginPage({
        clientName: 'Test',
        scope: '',
        pendingAuthId: 'pending',
        callbackPath: '/callback',
      });

      expect(html).toContain('viewport');
      expect(html).toContain('width=device-width');
    });
  });

  // ============================================
  // Template Builder Tests
  // ============================================

  describe('buildConsentPage', () => {
    const defaultParams = {
      apps: [
        { appId: 'slack', appName: 'Slack', description: 'Team communication' },
        { appId: 'github', appName: 'GitHub', requiredScopes: ['repo', 'user'] },
      ] as AppAuthCard[],
      clientName: 'Test Client',
      pendingAuthId: 'pending-123',
      csrfToken: 'csrf-token',
      callbackPath: '/oauth/callback',
    };

    it('should render consent page HTML', () => {
      const html = buildConsentPage(defaultParams);

      expect(html).toContain('Authorize Test Client');
      expect(html).toContain('Slack');
      expect(html).toContain('GitHub');
      expect(html).toContain('pending-123');
      expect(html).toContain('csrf-token');
    });

    it('should include app cards with HTMX attributes', () => {
      const html = buildConsentPage(defaultParams);

      expect(html).toContain('hx-post');
      expect(html).toContain('hx-swap');
      expect(html).toContain('hx-target');
      expect(html).toContain('data-app-id="slack"');
      expect(html).toContain('data-app-id="github"');
    });

    it('should show required scopes when present', () => {
      const html = buildConsentPage(defaultParams);

      expect(html).toContain('repo');
      expect(html).toContain('user');
      expect(html).toContain('Permissions');
    });

    it('should include progressive auth notice', () => {
      const html = buildConsentPage(defaultParams);

      expect(html).toContain('progressive authorization');
    });

    it('should include Authorize and Skip buttons', () => {
      const html = buildConsentPage(defaultParams);

      expect(html).toContain('Authorize');
      expect(html).toContain('Skip');
    });
  });

  describe('buildIncrementalAuthPage', () => {
    const defaultParams = {
      app: {
        appId: 'slack',
        appName: 'Slack',
        description: 'Team communication',
        requiredScopes: ['channels:read', 'chat:write'],
      } as AppAuthCard,
      toolId: 'slack:send_message',
      sessionHint: 'session-123',
      csrfToken: 'csrf-token',
      callbackPath: '/oauth/callback',
    };

    it('should render incremental auth page HTML', () => {
      const html = buildIncrementalAuthPage(defaultParams);

      expect(html).toContain('Authorization Required');
      expect(html).toContain('Slack');
      expect(html).toContain('slack:send_message');
    });

    it('should show warning icon', () => {
      const html = buildIncrementalAuthPage(defaultParams);

      expect(html).toContain('bg-amber-100');
      expect(html).toContain('text-amber-600');
    });

    it('should include incremental auth notice', () => {
      const html = buildIncrementalAuthPage(defaultParams);

      expect(html).toContain('incremental authorization');
      expect(html).toContain('existing session');
    });

    it('should include Cancel and Authorize buttons', () => {
      const html = buildIncrementalAuthPage(defaultParams);

      expect(html).toContain('Cancel');
      expect(html).toContain('Authorize');
    });
  });

  describe('buildFederatedLoginPage', () => {
    const defaultParams = {
      providers: [
        { providerId: '__parent__', providerName: 'Primary Auth', mode: 'orchestrated', appIds: [], isPrimary: true },
        {
          providerId: 'google',
          providerName: 'Google',
          mode: 'transparent',
          providerUrl: 'https://accounts.google.com',
          appIds: ['gmail', 'drive'],
        },
      ] as ProviderCard[],
      clientName: 'Test Client',
      pendingAuthId: 'pending-123',
      csrfToken: 'csrf-token',
      callbackPath: '/oauth/callback',
    };

    it('should render federated login page HTML', () => {
      const html = buildFederatedLoginPage(defaultParams);

      expect(html).toContain('Select Authorization Providers');
      expect(html).toContain('Primary Auth');
      expect(html).toContain('Google');
    });

    it('should show primary badge', () => {
      const html = buildFederatedLoginPage(defaultParams);

      expect(html).toContain('Primary');
      expect(html).toContain('bg-blue-600');
    });

    it('should include email input', () => {
      const html = buildFederatedLoginPage(defaultParams);

      expect(html).toContain('type="email"');
      expect(html).toContain('name="email"');
    });

    it('should include Skip All button', () => {
      const html = buildFederatedLoginPage(defaultParams);

      expect(html).toContain('Skip All');
    });

    it('should show provider URLs', () => {
      const html = buildFederatedLoginPage(defaultParams);

      expect(html).toContain('accounts.google.com');
    });

    it('should show app IDs', () => {
      const html = buildFederatedLoginPage(defaultParams);

      expect(html).toContain('gmail');
      expect(html).toContain('drive');
    });

    it('should include select all toggle', () => {
      const html = buildFederatedLoginPage(defaultParams);

      expect(html).toContain('Select all providers');
      expect(html).toContain('id="select-all"');
    });
  });

  describe('buildToolConsentPage', () => {
    const defaultParams = {
      tools: [
        {
          toolId: 'slack:send',
          toolName: 'Send Message',
          description: 'Send a message',
          appId: 'slack',
          appName: 'Slack',
        },
        { toolId: 'slack:read', toolName: 'Read Messages', appId: 'slack', appName: 'Slack' },
        { toolId: 'github:pr', toolName: 'Create PR', appId: 'github', appName: 'GitHub' },
      ] as ToolCard[],
      clientName: 'Test Client',
      pendingAuthId: 'pending-123',
      csrfToken: 'csrf-token',
      callbackPath: '/oauth/consent',
      userName: 'John Doe',
      userEmail: 'john@example.com',
    };

    it('should render tool consent page HTML', () => {
      const html = buildToolConsentPage(defaultParams);

      expect(html).toContain('Select Tools to Enable');
      expect(html).toContain('Send Message');
      expect(html).toContain('Read Messages');
      expect(html).toContain('Create PR');
    });

    it('should group tools by app', () => {
      const html = buildToolConsentPage(defaultParams);

      expect(html).toContain('Slack');
      expect(html).toContain('GitHub');
      expect(html).toContain('data-app="slack"');
      expect(html).toContain('data-app="github"');
    });

    it('should show user info', () => {
      const html = buildToolConsentPage(defaultParams);

      expect(html).toContain('Signed in as');
      expect(html).toContain('John Doe');
    });

    it('should include selection count', () => {
      const html = buildToolConsentPage(defaultParams);

      expect(html).toContain('selection-count');
      expect(html).toContain('3 of 3 selected');
    });

    it('should include toggle all buttons', () => {
      const html = buildToolConsentPage(defaultParams);

      expect(html).toContain('Select all tools');
      expect(html).toContain('Toggle All');
    });

    it('should include updateCount script', () => {
      const html = buildToolConsentPage(defaultParams);

      expect(html).toContain('function updateCount()');
    });
  });

  describe('buildLoginPage', () => {
    const defaultParams = {
      clientName: 'Test Client',
      scope: 'openid profile email',
      pendingAuthId: 'pending-123',
      callbackPath: '/oauth/callback',
    };

    it('should render login page HTML', () => {
      const html = buildLoginPage(defaultParams);

      expect(html).toContain('Sign In');
      expect(html).toContain('Test Client');
    });

    it('should show requested scopes', () => {
      const html = buildLoginPage(defaultParams);

      expect(html).toContain('Requested permissions');
      expect(html).toContain('openid');
      expect(html).toContain('profile');
      expect(html).toContain('email');
    });

    it('should include email and name inputs', () => {
      const html = buildLoginPage(defaultParams);

      expect(html).toContain('type="email"');
      expect(html).toContain('name="email"');
      expect(html).toContain('name="name"');
    });

    it('should include hidden pending auth ID', () => {
      const html = buildLoginPage(defaultParams);

      expect(html).toContain('pending_auth_id');
      expect(html).toContain('pending-123');
    });

    it('should not show scopes section when scope is empty', () => {
      const html = buildLoginPage({
        ...defaultParams,
        scope: '',
      });

      expect(html).not.toContain('Requested permissions');
    });
  });

  describe('buildErrorPage', () => {
    const defaultParams = {
      error: 'invalid_request',
      description: 'The request was missing required parameters',
    };

    it('should render error page HTML', () => {
      const html = buildErrorPage(defaultParams);

      expect(html).toContain('Authorization Error');
      expect(html).toContain('invalid_request');
      expect(html).toContain('missing required parameters');
    });

    it('should show error icon', () => {
      const html = buildErrorPage(defaultParams);

      expect(html).toContain('bg-red-100');
      expect(html).toContain('text-red-600');
    });

    it('should style error code', () => {
      const html = buildErrorPage(defaultParams);

      expect(html).toContain('<code');
      expect(html).toContain('font-mono');
    });
  });

  // ============================================
  // Security Tests
  // ============================================

  describe('Security', () => {
    it('should escape special characters in app names', () => {
      const html = buildConsentPage({
        apps: [{ appId: 'test', appName: 'Test <script>alert("xss")</script>' }],
        clientName: 'Client',
        pendingAuthId: 'pending',
        csrfToken: 'csrf',
        callbackPath: '/callback',
      });

      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    });

    it('should escape special characters in tool descriptions', () => {
      const html = buildToolConsentPage({
        tools: [
          { toolId: 't1', toolName: 'Tool', description: '<img onerror="alert(1)">', appId: 'app', appName: 'App' },
        ],
        clientName: 'Client',
        pendingAuthId: 'pending',
        csrfToken: 'csrf',
        callbackPath: '/callback',
      });

      expect(html).toContain('&lt;img');
      expect(html).not.toContain('<img onerror');
    });

    it('should escape special characters in error messages', () => {
      const html = buildErrorPage({
        error: 'test_error',
        description: '<script>evil()</script>',
      });

      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>evil');
    });
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe('Integration', () => {
    it('should produce valid HTML structure', () => {
      const html = buildConsentPage({
        apps: [{ appId: 'test', appName: 'Test' }],
        clientName: 'Client',
        pendingAuthId: 'pending',
        csrfToken: 'csrf',
        callbackPath: '/callback',
      });

      // Check basic HTML structure
      expect(html).toMatch(/<html[^>]*>/);
      expect(html).toMatch(/<\/html>/);
      expect(html).toMatch(/<head>/);
      expect(html).toMatch(/<\/head>/);
      expect(html).toMatch(/<body[^>]*>/);
      expect(html).toMatch(/<\/body>/);
    });

    it('should handle empty app list', () => {
      const html = buildConsentPage({
        apps: [],
        clientName: 'Client',
        pendingAuthId: 'pending',
        csrfToken: 'csrf',
        callbackPath: '/callback',
      });

      expect(html).toContain('Authorize Client');
    });

    it('should handle apps without descriptions', () => {
      const html = buildConsentPage({
        apps: [{ appId: 'test', appName: 'Test App' }],
        clientName: 'Client',
        pendingAuthId: 'pending',
        csrfToken: 'csrf',
        callbackPath: '/callback',
      });

      expect(html).toContain('Test App');
    });

    it('should handle tools without descriptions', () => {
      const html = buildToolConsentPage({
        tools: [{ toolId: 't1', toolName: 'Tool Name', appId: 'app', appName: 'App' }],
        clientName: 'Client',
        pendingAuthId: 'pending',
        csrfToken: 'csrf',
        callbackPath: '/callback',
      });

      expect(html).toContain('Tool Name');
    });
  });
});
