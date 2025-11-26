/**
 * Consent Types Tests
 *
 * Tests for the consent and federated login type schemas.
 */
import {
  consentToolItemSchema,
  consentSelectionSchema,
  consentStateSchema,
  consentConfigSchema,
  federatedProviderItemSchema,
  federatedLoginStateSchema,
  federatedSelectionSchema,
  ConsentToolItem,
  ConsentSelection,
  ConsentState,
  ConsentConfig,
  FederatedProviderItem,
  FederatedLoginState,
  FederatedSelection,
} from '../consent.types';

describe('Consent Types', () => {
  // ============================================
  // Consent Tool Item Schema Tests
  // ============================================

  describe('consentToolItemSchema', () => {
    it('should validate a complete tool item', () => {
      const item: ConsentToolItem = {
        id: 'slack:send_message',
        name: 'Send Message',
        description: 'Send a message to a Slack channel',
        appId: 'slack',
        appName: 'Slack',
        defaultSelected: true,
        requiredScopes: ['chat:write'],
        category: 'write',
      };

      const result = consentToolItemSchema.safeParse(item);
      expect(result.success).toBe(true);
    });

    it('should validate minimal tool item', () => {
      const item = {
        id: 'github:list_repos',
        name: 'List Repositories',
        appId: 'github',
        appName: 'GitHub',
      };

      const result = consentToolItemSchema.safeParse(item);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultSelected).toBe(true); // default value
      }
    });

    it('should reject empty id', () => {
      const item = {
        id: '',
        name: 'Test Tool',
        appId: 'test',
        appName: 'Test App',
      };

      const result = consentToolItemSchema.safeParse(item);
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const item = {
        id: 'test:tool',
        name: '',
        appId: 'test',
        appName: 'Test App',
      };

      const result = consentToolItemSchema.safeParse(item);
      expect(result.success).toBe(false);
    });
  });

  // ============================================
  // Consent Selection Schema Tests
  // ============================================

  describe('consentSelectionSchema', () => {
    it('should validate a complete selection', () => {
      const selection: ConsentSelection = {
        selectedTools: ['slack:send_message', 'github:create_issue'],
        allSelected: false,
        consentedAt: new Date().toISOString(),
        consentVersion: '1.0',
      };

      const result = consentSelectionSchema.safeParse(selection);
      expect(result.success).toBe(true);
    });

    it('should validate selection with all selected', () => {
      const selection = {
        selectedTools: ['tool1', 'tool2', 'tool3'],
        allSelected: true,
        consentedAt: new Date().toISOString(),
      };

      const result = consentSelectionSchema.safeParse(selection);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.consentVersion).toBe('1.0'); // default value
      }
    });

    it('should reject invalid datetime', () => {
      const selection = {
        selectedTools: ['tool1'],
        allSelected: false,
        consentedAt: 'not-a-date',
      };

      const result = consentSelectionSchema.safeParse(selection);
      expect(result.success).toBe(false);
    });
  });

  // ============================================
  // Consent State Schema Tests
  // ============================================

  describe('consentStateSchema', () => {
    it('should validate enabled consent state', () => {
      const state: ConsentState = {
        enabled: true,
        availableTools: [
          {
            id: 'slack:send_message',
            name: 'Send Message',
            appId: 'slack',
            appName: 'Slack',
            defaultSelected: true,
          },
        ],
        preselectedTools: ['slack:send_message'],
        groupByApp: true,
        customMessage: 'Select the tools you want to enable',
      };

      const result = consentStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    it('should validate minimal consent state', () => {
      const state = {
        enabled: false,
        availableTools: [],
      };

      const result = consentStateSchema.safeParse(state);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.groupByApp).toBe(true); // default value
      }
    });
  });

  // ============================================
  // Consent Config Schema Tests
  // ============================================

  describe('consentConfigSchema', () => {
    it('should validate complete config', () => {
      const config: ConsentConfig = {
        enabled: true,
        groupByApp: true,
        showDescriptions: true,
        allowSelectAll: true,
        requireSelection: true,
        customMessage: 'Choose your tools',
        rememberConsent: true,
        excludedTools: ['essential:tool'],
        defaultSelectedTools: ['default:tool'],
      };

      const result = consentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const config = {};

      const result = consentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(false);
        expect(result.data.groupByApp).toBe(true);
        expect(result.data.showDescriptions).toBe(true);
        expect(result.data.allowSelectAll).toBe(true);
        expect(result.data.requireSelection).toBe(true);
        expect(result.data.rememberConsent).toBe(true);
      }
    });

    it('should validate disabled config', () => {
      const config = {
        enabled: false,
      };

      const result = consentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  // ============================================
  // Federated Provider Item Schema Tests
  // ============================================

  describe('federatedProviderItemSchema', () => {
    it('should validate a complete provider item', () => {
      const provider: FederatedProviderItem = {
        id: 'slack-auth',
        name: 'Slack',
        description: 'Slack OAuth provider',
        icon: 'https://slack.com/icon.png',
        type: 'remote',
        providerUrl: 'https://slack.com/oauth',
        appIds: ['slack'],
        appNames: ['Slack'],
        scopes: ['chat:write', 'channels:read'],
        isPrimary: false,
        isOptional: true,
      };

      const result = federatedProviderItemSchema.safeParse(provider);
      expect(result.success).toBe(true);
    });

    it('should validate minimal provider item', () => {
      const provider = {
        id: 'local',
        name: 'Local Auth',
        type: 'local' as const,
        appIds: [],
        appNames: [],
        scopes: [],
        isPrimary: true,
      };

      const result = federatedProviderItemSchema.safeParse(provider);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isOptional).toBe(false); // default value
      }
    });

    it('should validate transparent provider', () => {
      const provider = {
        id: 'github-auth',
        name: 'GitHub',
        type: 'transparent' as const,
        providerUrl: 'https://github.com/login/oauth',
        appIds: ['github'],
        appNames: ['GitHub'],
        scopes: ['repo', 'user'],
        isPrimary: false,
      };

      const result = federatedProviderItemSchema.safeParse(provider);
      expect(result.success).toBe(true);
    });

    it('should reject invalid type', () => {
      const provider = {
        id: 'test',
        name: 'Test',
        type: 'invalid',
        appIds: [],
        appNames: [],
        scopes: [],
        isPrimary: false,
      };

      const result = federatedProviderItemSchema.safeParse(provider);
      expect(result.success).toBe(false);
    });
  });

  // ============================================
  // Federated Login State Schema Tests
  // ============================================

  describe('federatedLoginStateSchema', () => {
    it('should validate complete login state', () => {
      const state: FederatedLoginState = {
        providers: [
          {
            id: 'local',
            name: 'Local Auth',
            type: 'local',
            appIds: [],
            appNames: [],
            scopes: [],
            isPrimary: true,
            isOptional: false,
          },
          {
            id: 'slack-auth',
            name: 'Slack',
            type: 'remote',
            appIds: ['slack'],
            appNames: ['Slack'],
            scopes: ['chat:write'],
            isPrimary: false,
            isOptional: true,
          },
        ],
        primaryProviderId: 'local',
        allowSkip: true,
        preselectedProviders: ['local'],
      };

      const result = federatedLoginStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    it('should validate minimal login state', () => {
      const state = {
        providers: [],
      };

      const result = federatedLoginStateSchema.safeParse(state);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowSkip).toBe(true); // default value
      }
    });
  });

  // ============================================
  // Federated Selection Schema Tests
  // ============================================

  describe('federatedSelectionSchema', () => {
    it('should validate complete selection', () => {
      const selection: FederatedSelection = {
        selectedProviders: ['local', 'slack-auth'],
        skippedProviders: ['github-auth'],
        providerMetadata: {
          'slack-auth': { workspace: 'my-workspace' },
        },
      };

      const result = federatedSelectionSchema.safeParse(selection);
      expect(result.success).toBe(true);
    });

    it('should validate minimal selection', () => {
      const selection = {
        selectedProviders: ['local'],
        skippedProviders: [],
      };

      const result = federatedSelectionSchema.safeParse(selection);
      expect(result.success).toBe(true);
    });

    it('should validate empty selection', () => {
      const selection = {
        selectedProviders: [],
        skippedProviders: ['provider1', 'provider2'],
      };

      const result = federatedSelectionSchema.safeParse(selection);
      expect(result.success).toBe(true);
    });
  });
});
