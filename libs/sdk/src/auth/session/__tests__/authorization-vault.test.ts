/**
 * Authorization Vault Tests
 *
 * Tests for the stateful session storage system.
 */
import {
  InMemoryAuthorizationVault,
  AuthorizationVault,
  AuthorizationVaultEntry,
  VaultConsentRecord,
  VaultFederatedRecord,
  PendingIncrementalAuth,
  AppCredential,
  Credential,
  OAuthCredential,
  ApiKeyCredential,
  BasicAuthCredential,
  BearerCredential,
  PrivateKeyCredential,
  MtlsCredential,
  CustomCredential,
  // Schemas
  vaultConsentRecordSchema,
  vaultFederatedRecordSchema,
  pendingIncrementalAuthSchema,
  authorizationVaultEntrySchema,
  credentialTypeSchema,
  oauthCredentialSchema,
  apiKeyCredentialSchema,
  basicAuthCredentialSchema,
  bearerCredentialSchema,
  privateKeyCredentialSchema,
  mtlsCredentialSchema,
  customCredentialSchema,
  credentialSchema,
  appCredentialSchema,
} from '../authorization-vault';

describe('Authorization Vault', () => {
  // ============================================
  // Schema Validation Tests
  // ============================================

  describe('Schemas', () => {
    describe('vaultConsentRecordSchema', () => {
      it('should validate consent record', () => {
        const consent: VaultConsentRecord = {
          enabled: true,
          selectedToolIds: ['slack:send_message', 'github:create_issue'],
          availableToolIds: ['slack:send_message', 'slack:list_channels', 'github:create_issue'],
          consentedAt: Date.now(),
          version: '1.0',
        };

        const result = vaultConsentRecordSchema.safeParse(consent);
        expect(result.success).toBe(true);
      });

      it('should apply default version', () => {
        const consent = {
          enabled: true,
          selectedToolIds: ['tool1'],
          availableToolIds: ['tool1', 'tool2'],
          consentedAt: Date.now(),
        };

        const result = vaultConsentRecordSchema.safeParse(consent);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.version).toBe('1.0');
        }
      });
    });

    describe('vaultFederatedRecordSchema', () => {
      it('should validate federated record', () => {
        const federated: VaultFederatedRecord = {
          selectedProviderIds: ['local', 'slack-auth'],
          skippedProviderIds: ['github-auth'],
          primaryProviderId: 'local',
          completedAt: Date.now(),
        };

        const result = vaultFederatedRecordSchema.safeParse(federated);
        expect(result.success).toBe(true);
      });

      it('should validate minimal federated record', () => {
        const federated = {
          selectedProviderIds: ['local'],
          skippedProviderIds: [],
          completedAt: Date.now(),
        };

        const result = vaultFederatedRecordSchema.safeParse(federated);
        expect(result.success).toBe(true);
      });
    });

    describe('pendingIncrementalAuthSchema', () => {
      it('should validate pending auth request', () => {
        const pending: PendingIncrementalAuth = {
          id: 'pending-123',
          appId: 'slack',
          toolId: 'slack:send_message',
          authUrl: 'https://example.com/oauth/authorize?app=slack',
          requiredScopes: ['chat:write'],
          elicitId: 'elicit-456',
          createdAt: Date.now(),
          expiresAt: Date.now() + 600000,
          status: 'pending',
        };

        const result = pendingIncrementalAuthSchema.safeParse(pending);
        expect(result.success).toBe(true);
      });

      it('should validate all status types', () => {
        const statuses = ['pending', 'completed', 'cancelled', 'expired'] as const;

        for (const status of statuses) {
          const pending = {
            id: 'pending-123',
            appId: 'slack',
            authUrl: 'https://example.com/auth',
            createdAt: Date.now(),
            expiresAt: Date.now() + 600000,
            status,
          };

          const result = pendingIncrementalAuthSchema.safeParse(pending);
          expect(result.success).toBe(true);
        }
      });

      it('should reject invalid status', () => {
        const pending = {
          id: 'pending-123',
          appId: 'slack',
          authUrl: 'https://example.com/auth',
          createdAt: Date.now(),
          expiresAt: Date.now() + 600000,
          status: 'invalid',
        };

        const result = pendingIncrementalAuthSchema.safeParse(pending);
        expect(result.success).toBe(false);
      });
    });

    describe('authorizationVaultEntrySchema', () => {
      it('should validate complete vault entry', () => {
        const entry: AuthorizationVaultEntry = {
          id: 'vault-123',
          userSub: 'user-456',
          userEmail: 'user@example.com',
          userName: 'Test User',
          clientId: 'client-789',
          createdAt: Date.now(),
          lastAccessAt: Date.now(),
          appCredentials: {},
          consent: {
            enabled: true,
            selectedToolIds: ['slack:send_message'],
            availableToolIds: ['slack:send_message'],
            consentedAt: Date.now(),
            version: '1.0',
          },
          federated: {
            selectedProviderIds: ['local'],
            skippedProviderIds: [],
            completedAt: Date.now(),
          },
          pendingAuths: [],
          authorizedAppIds: ['slack'],
          skippedAppIds: ['github'],
        };

        const result = authorizationVaultEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
      });

      it('should validate minimal vault entry', () => {
        const entry = {
          id: 'vault-123',
          userSub: 'user-456',
          clientId: 'client-789',
          createdAt: Date.now(),
          lastAccessAt: Date.now(),
          pendingAuths: [],
          authorizedAppIds: [],
          skippedAppIds: [],
        };

        const result = authorizationVaultEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
      });

      it('should apply default appCredentials', () => {
        const entry = {
          id: 'vault-123',
          userSub: 'user-456',
          clientId: 'client-789',
          createdAt: Date.now(),
          lastAccessAt: Date.now(),
          pendingAuths: [],
          authorizedAppIds: [],
          skippedAppIds: [],
        };

        const result = authorizationVaultEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.appCredentials).toEqual({});
        }
      });
    });

    // ============================================
    // Credential Type Schemas
    // ============================================

    describe('credentialTypeSchema', () => {
      it('should validate all credential types', () => {
        const types = ['oauth', 'api_key', 'basic', 'bearer', 'private_key', 'mtls', 'custom'];
        for (const type of types) {
          const result = credentialTypeSchema.safeParse(type);
          expect(result.success).toBe(true);
        }
      });

      it('should reject invalid credential type', () => {
        const result = credentialTypeSchema.safeParse('invalid');
        expect(result.success).toBe(false);
      });
    });

    describe('oauthCredentialSchema', () => {
      it('should validate complete OAuth credential', () => {
        const credential: OAuthCredential = {
          type: 'oauth',
          accessToken: 'test-slack-access-token',
          refreshToken: 'test-refresh',
          tokenType: 'Bearer',
          expiresAt: Date.now() + 3600000,
          scopes: ['chat:write', 'channels:read'],
          idToken: 'eyJ...',
        };

        const result = oauthCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate minimal OAuth credential', () => {
        const credential = {
          type: 'oauth',
          accessToken: 'token123',
        };

        const result = oauthCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.tokenType).toBe('Bearer');
          expect(result.data.scopes).toEqual([]);
        }
      });

      it('should reject OAuth credential without access token', () => {
        const credential = {
          type: 'oauth',
        };

        const result = oauthCredentialSchema.safeParse(credential);
        expect(result.success).toBe(false);
      });
    });

    describe('apiKeyCredentialSchema', () => {
      it('should validate complete API key credential', () => {
        const credential: ApiKeyCredential = {
          type: 'api_key',
          key: 'sk-1234567890abcdef',
          headerName: 'Authorization',
          headerPrefix: 'Bearer ',
          queryParam: 'api_key',
        };

        const result = apiKeyCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate minimal API key credential', () => {
        const credential = {
          type: 'api_key',
          key: 'my-api-key',
        };

        const result = apiKeyCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.headerName).toBe('X-API-Key');
        }
      });

      it('should reject empty API key', () => {
        const credential = {
          type: 'api_key',
          key: '',
        };

        const result = apiKeyCredentialSchema.safeParse(credential);
        expect(result.success).toBe(false);
      });
    });

    describe('basicAuthCredentialSchema', () => {
      it('should validate complete Basic Auth credential', () => {
        const credential: BasicAuthCredential = {
          type: 'basic',
          username: 'user@example.com',
          password: 'secret123',
          encodedValue: 'dXNlckBleGFtcGxlLmNvbTpzZWNyZXQxMjM=',
        };

        const result = basicAuthCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate minimal Basic Auth credential', () => {
        const credential = {
          type: 'basic',
          username: 'admin',
          password: '',
        };

        const result = basicAuthCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should reject empty username', () => {
        const credential = {
          type: 'basic',
          username: '',
          password: 'secret',
        };

        const result = basicAuthCredentialSchema.safeParse(credential);
        expect(result.success).toBe(false);
      });
    });

    describe('bearerCredentialSchema', () => {
      it('should validate complete Bearer credential', () => {
        const credential: BearerCredential = {
          type: 'bearer',
          token: 'static-bearer-token-123',
          expiresAt: Date.now() + 86400000,
        };

        const result = bearerCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate minimal Bearer credential', () => {
        const credential = {
          type: 'bearer',
          token: 'my-token',
        };

        const result = bearerCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should reject empty token', () => {
        const credential = {
          type: 'bearer',
          token: '',
        };

        const result = bearerCredentialSchema.safeParse(credential);
        expect(result.success).toBe(false);
      });
    });

    describe('privateKeyCredentialSchema', () => {
      it('should validate PEM private key credential', () => {
        const credential: PrivateKeyCredential = {
          type: 'private_key',
          format: 'pem',
          keyData: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBAD...',
          keyId: 'key-123',
          algorithm: 'RS256',
          certificate: '-----BEGIN CERTIFICATE-----\nMIID...',
        };

        const result = privateKeyCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate JWK private key credential', () => {
        const credential = {
          type: 'private_key',
          format: 'jwk',
          keyData: '{"kty":"RSA","n":"...","e":"AQAB","d":"..."}',
          keyId: 'jwk-key-1',
        };

        const result = privateKeyCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate PKCS12 with passphrase', () => {
        const credential = {
          type: 'private_key',
          format: 'pkcs12',
          keyData: 'base64-encoded-pkcs12',
          passphrase: 'my-secret-passphrase',
        };

        const result = privateKeyCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should reject invalid format', () => {
        const credential = {
          type: 'private_key',
          format: 'invalid',
          keyData: 'key-data',
        };

        const result = privateKeyCredentialSchema.safeParse(credential);
        expect(result.success).toBe(false);
      });
    });

    describe('mtlsCredentialSchema', () => {
      it('should validate complete mTLS credential', () => {
        const credential: MtlsCredential = {
          type: 'mtls',
          certificate: '-----BEGIN CERTIFICATE-----\nMIID...',
          privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEv...',
          passphrase: 'key-passphrase',
          caCertificate: '-----BEGIN CERTIFICATE-----\nMIIB...',
        };

        const result = mtlsCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate minimal mTLS credential', () => {
        const credential = {
          type: 'mtls',
          certificate: '-----BEGIN CERTIFICATE-----',
          privateKey: '-----BEGIN PRIVATE KEY-----',
        };

        const result = mtlsCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });
    });

    describe('customCredentialSchema', () => {
      it('should validate complete custom credential', () => {
        const credential: CustomCredential = {
          type: 'custom',
          customType: 'aws-sigv4',
          data: {
            accessKeyId: 'AKIA...',
            secretAccessKey: 'secret...',
            region: 'us-east-1',
          },
          headers: {
            'X-Custom-Header': 'value',
          },
        };

        const result = customCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate minimal custom credential', () => {
        const credential = {
          type: 'custom',
          customType: 'webhook-signature',
          data: {
            secret: 'whsec_...',
          },
        };

        const result = customCredentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should reject empty customType', () => {
        const credential = {
          type: 'custom',
          customType: '',
          data: {},
        };

        const result = customCredentialSchema.safeParse(credential);
        expect(result.success).toBe(false);
      });
    });

    describe('credentialSchema (discriminated union)', () => {
      it('should validate OAuth credential', () => {
        const credential: Credential = {
          type: 'oauth',
          accessToken: 'token',
          tokenType: 'Bearer',
          scopes: [],
        };

        const result = credentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate API key credential', () => {
        const credential: Credential = {
          type: 'api_key',
          key: 'api-key',
          headerName: 'X-API-Key',
        };

        const result = credentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate Basic Auth credential', () => {
        const credential: Credential = {
          type: 'basic',
          username: 'user',
          password: 'pass',
        };

        const result = credentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate Bearer credential', () => {
        const credential: Credential = {
          type: 'bearer',
          token: 'bearer-token',
        };

        const result = credentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate Private Key credential', () => {
        const credential: Credential = {
          type: 'private_key',
          format: 'pem',
          keyData: 'key-data',
        };

        const result = credentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate mTLS credential', () => {
        const credential: Credential = {
          type: 'mtls',
          certificate: 'cert',
          privateKey: 'key',
        };

        const result = credentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should validate Custom credential', () => {
        const credential: Credential = {
          type: 'custom',
          customType: 'custom-type',
          data: { key: 'value' },
        };

        const result = credentialSchema.safeParse(credential);
        expect(result.success).toBe(true);
      });

      it('should reject invalid type', () => {
        const credential = {
          type: 'invalid',
          data: {},
        };

        const result = credentialSchema.safeParse(credential);
        expect(result.success).toBe(false);
      });
    });

    describe('appCredentialSchema', () => {
      it('should validate complete app credential with OAuth', () => {
        const appCredential: AppCredential = {
          appId: 'slack',
          providerId: 'slack-oauth',
          credential: {
            type: 'oauth',
            accessToken: 'test-slack-token',
            refreshToken: 'test-refresh',
            tokenType: 'Bearer',
            scopes: ['chat:write'],
          },
          acquiredAt: Date.now(),
          lastUsedAt: Date.now(),
          expiresAt: Date.now() + 3600000,
          isValid: true,
          userInfo: {
            sub: 'U123',
            email: 'user@example.com',
            name: 'Test User',
          },
          metadata: {
            teamId: 'T123',
          },
        };

        const result = appCredentialSchema.safeParse(appCredential);
        expect(result.success).toBe(true);
      });

      it('should validate app credential with API key', () => {
        const appCredential = {
          appId: 'openai',
          providerId: 'openai-api',
          credential: {
            type: 'api_key',
            key: 'sk-...',
          },
          acquiredAt: Date.now(),
        };

        const result = appCredentialSchema.safeParse(appCredential);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.isValid).toBe(true);
        }
      });

      it('should validate invalid app credential', () => {
        const appCredential = {
          appId: 'github',
          providerId: 'github-oauth',
          credential: {
            type: 'oauth',
            accessToken: 'expired-token',
            scopes: [],
          },
          acquiredAt: Date.now() - 3600000,
          isValid: false,
          invalidReason: 'Token expired',
        };

        const result = appCredentialSchema.safeParse(appCredential);
        expect(result.success).toBe(true);
      });

      it('should reject empty appId', () => {
        const appCredential = {
          appId: '',
          providerId: 'provider',
          credential: {
            type: 'bearer',
            token: 'token',
          },
          acquiredAt: Date.now(),
        };

        const result = appCredentialSchema.safeParse(appCredential);
        expect(result.success).toBe(false);
      });

      it('should reject empty providerId', () => {
        const appCredential = {
          appId: 'app',
          providerId: '',
          credential: {
            type: 'bearer',
            token: 'token',
          },
          acquiredAt: Date.now(),
        };

        const result = appCredentialSchema.safeParse(appCredential);
        expect(result.success).toBe(false);
      });
    });
  });

  // ============================================
  // InMemoryAuthorizationVault Tests
  // ============================================

  describe('InMemoryAuthorizationVault', () => {
    let vault: AuthorizationVault;

    beforeEach(() => {
      vault = new InMemoryAuthorizationVault();
    });

    describe('create', () => {
      it('should create a new vault entry', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          userEmail: 'user@example.com',
          userName: 'Test User',
          clientId: 'client-456',
        });

        expect(entry.id).toBeDefined();
        expect(entry.userSub).toBe('user-123');
        expect(entry.userEmail).toBe('user@example.com');
        expect(entry.userName).toBe('Test User');
        expect(entry.clientId).toBe('client-456');
        expect(entry.createdAt).toBeDefined();
        expect(entry.lastAccessAt).toBeDefined();
        expect(entry.pendingAuths).toEqual([]);
        expect(entry.authorizedAppIds).toEqual([]);
        expect(entry.skippedAppIds).toEqual([]);
      });

      it('should create entry with consent record', async () => {
        const consent: VaultConsentRecord = {
          enabled: true,
          selectedToolIds: ['tool1', 'tool2'],
          availableToolIds: ['tool1', 'tool2', 'tool3'],
          consentedAt: Date.now(),
          version: '1.0',
        };

        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          consent,
        });

        expect(entry.consent).toEqual(consent);
      });

      it('should create entry with federated record', async () => {
        const federated: VaultFederatedRecord = {
          selectedProviderIds: ['local', 'slack'],
          skippedProviderIds: ['github'],
          primaryProviderId: 'local',
          completedAt: Date.now(),
        };

        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          federated,
        });

        expect(entry.federated).toEqual(federated);
      });

      it('should create entry with authorized and skipped apps', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          authorizedAppIds: ['slack', 'github'],
          skippedAppIds: ['jira'],
        });

        expect(entry.authorizedAppIds).toEqual(['slack', 'github']);
        expect(entry.skippedAppIds).toEqual(['jira']);
      });
    });

    describe('get', () => {
      it('should retrieve an existing vault entry', async () => {
        const created = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        const retrieved = await vault.get(created.id);

        expect(retrieved).not.toBeNull();
        expect(retrieved?.id).toBe(created.id);
        expect(retrieved?.userSub).toBe('user-123');
      });

      it('should return null for non-existent entry', async () => {
        const retrieved = await vault.get('non-existent-id');
        expect(retrieved).toBeNull();
      });

      it('should update lastAccessAt on get', async () => {
        const created = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        const originalLastAccess = created.lastAccessAt;

        // Small delay to ensure time difference
        await new Promise((resolve) => setTimeout(resolve, 10));

        const retrieved = await vault.get(created.id);

        expect(retrieved?.lastAccessAt).toBeGreaterThanOrEqual(originalLastAccess);
      });
    });

    describe('update', () => {
      it('should update vault entry fields', async () => {
        const created = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        await vault.update(created.id, {
          userName: 'Updated Name',
          userEmail: 'updated@example.com',
        });

        const retrieved = await vault.get(created.id);

        expect(retrieved?.userName).toBe('Updated Name');
        expect(retrieved?.userEmail).toBe('updated@example.com');
      });

      it('should not throw for non-existent entry', async () => {
        await expect(vault.update('non-existent', { userName: 'Test' })).resolves.not.toThrow();
      });
    });

    describe('delete', () => {
      it('should delete a vault entry', async () => {
        const created = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        await vault.delete(created.id);

        const retrieved = await vault.get(created.id);
        expect(retrieved).toBeNull();
      });

      it('should not throw for non-existent entry', async () => {
        await expect(vault.delete('non-existent')).resolves.not.toThrow();
      });
    });

    describe('Consent', () => {
      it('should update consent record', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        const consent: VaultConsentRecord = {
          enabled: true,
          selectedToolIds: ['tool1', 'tool2'],
          availableToolIds: ['tool1', 'tool2', 'tool3'],
          consentedAt: Date.now(),
          version: '1.0',
        };

        await vault.updateConsent(entry.id, consent);

        const retrieved = await vault.get(entry.id);
        expect(retrieved?.consent).toEqual(consent);
      });

      it('should replace existing consent', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          consent: {
            enabled: true,
            selectedToolIds: ['tool1'],
            availableToolIds: ['tool1'],
            consentedAt: Date.now() - 1000,
            version: '1.0',
          },
        });

        const newConsent: VaultConsentRecord = {
          enabled: true,
          selectedToolIds: ['tool1', 'tool2', 'tool3'],
          availableToolIds: ['tool1', 'tool2', 'tool3'],
          consentedAt: Date.now(),
          version: '2.0',
        };

        await vault.updateConsent(entry.id, newConsent);

        const retrieved = await vault.get(entry.id);
        expect(retrieved?.consent?.selectedToolIds).toEqual(['tool1', 'tool2', 'tool3']);
        expect(retrieved?.consent?.version).toBe('2.0');
      });
    });

    describe('App Authorization', () => {
      it('should authorize an app', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          skippedAppIds: ['slack', 'github'],
        });

        await vault.authorizeApp(entry.id, 'slack');

        const retrieved = await vault.get(entry.id);
        expect(retrieved?.authorizedAppIds).toContain('slack');
        expect(retrieved?.skippedAppIds).not.toContain('slack');
        expect(retrieved?.skippedAppIds).toContain('github');
      });

      it('should not duplicate authorized apps', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          authorizedAppIds: ['slack'],
        });

        await vault.authorizeApp(entry.id, 'slack');

        const retrieved = await vault.get(entry.id);
        expect(retrieved?.authorizedAppIds.filter((id) => id === 'slack')).toHaveLength(1);
      });

      it('should check if app is authorized', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          authorizedAppIds: ['slack'],
          skippedAppIds: ['github'],
        });

        expect(await vault.isAppAuthorized(entry.id, 'slack')).toBe(true);
        expect(await vault.isAppAuthorized(entry.id, 'github')).toBe(false);
        expect(await vault.isAppAuthorized(entry.id, 'unknown')).toBe(false);
      });

      it('should return false for non-existent vault', async () => {
        expect(await vault.isAppAuthorized('non-existent', 'slack')).toBe(false);
      });
    });

    describe('Pending Incremental Auth', () => {
      it('should create a pending auth request', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        const pending = await vault.createPendingAuth(entry.id, {
          appId: 'slack',
          toolId: 'slack:send_message',
          authUrl: 'https://example.com/oauth/authorize?app=slack',
          requiredScopes: ['chat:write'],
        });

        expect(pending.id).toBeDefined();
        expect(pending.appId).toBe('slack');
        expect(pending.toolId).toBe('slack:send_message');
        expect(pending.status).toBe('pending');
        expect(pending.createdAt).toBeDefined();
        expect(pending.expiresAt).toBeGreaterThan(pending.createdAt);
      });

      it('should create pending auth with elicit ID', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        const pending = await vault.createPendingAuth(entry.id, {
          appId: 'slack',
          authUrl: 'https://example.com/auth',
          elicitId: 'elicit-123',
        });

        expect(pending.elicitId).toBe('elicit-123');
      });

      it('should throw for non-existent vault', async () => {
        await expect(
          vault.createPendingAuth('non-existent', {
            appId: 'slack',
            authUrl: 'https://example.com/auth',
          }),
        ).rejects.toThrow('Vault not found');
      });

      it('should get pending auth by ID', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        const created = await vault.createPendingAuth(entry.id, {
          appId: 'slack',
          authUrl: 'https://example.com/auth',
        });

        const retrieved = await vault.getPendingAuth(entry.id, created.id);

        expect(retrieved).not.toBeNull();
        expect(retrieved?.id).toBe(created.id);
        expect(retrieved?.appId).toBe('slack');
      });

      it('should return null for non-existent pending auth', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        const retrieved = await vault.getPendingAuth(entry.id, 'non-existent');
        expect(retrieved).toBeNull();
      });

      it('should complete pending auth and authorize app', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          skippedAppIds: ['slack'],
        });

        const pending = await vault.createPendingAuth(entry.id, {
          appId: 'slack',
          authUrl: 'https://example.com/auth',
        });

        await vault.completePendingAuth(entry.id, pending.id);

        const retrieved = await vault.getPendingAuth(entry.id, pending.id);
        expect(retrieved?.status).toBe('completed');

        // App should now be authorized
        expect(await vault.isAppAuthorized(entry.id, 'slack')).toBe(true);
      });

      it('should cancel pending auth', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        const pending = await vault.createPendingAuth(entry.id, {
          appId: 'slack',
          authUrl: 'https://example.com/auth',
        });

        await vault.cancelPendingAuth(entry.id, pending.id);

        const retrieved = await vault.getPendingAuth(entry.id, pending.id);
        expect(retrieved?.status).toBe('cancelled');
      });

      it('should get all pending auths', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        await vault.createPendingAuth(entry.id, {
          appId: 'slack',
          authUrl: 'https://example.com/auth/slack',
        });

        await vault.createPendingAuth(entry.id, {
          appId: 'github',
          authUrl: 'https://example.com/auth/github',
        });

        const pendings = await vault.getPendingAuths(entry.id);

        expect(pendings).toHaveLength(2);
        expect(pendings.map((p) => p.appId)).toContain('slack');
        expect(pendings.map((p) => p.appId)).toContain('github');
      });

      it('should filter out non-pending auths', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        const pending1 = await vault.createPendingAuth(entry.id, {
          appId: 'slack',
          authUrl: 'https://example.com/auth/slack',
        });

        await vault.createPendingAuth(entry.id, {
          appId: 'github',
          authUrl: 'https://example.com/auth/github',
        });

        await vault.completePendingAuth(entry.id, pending1.id);

        const pendings = await vault.getPendingAuths(entry.id);

        expect(pendings).toHaveLength(1);
        expect(pendings[0].appId).toBe('github');
      });

      it('should return empty array for non-existent vault', async () => {
        const pendings = await vault.getPendingAuths('non-existent');
        expect(pendings).toEqual([]);
      });

      it('should mark expired auths as expired', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        // Create with very short TTL (already expired)
        const pending = await vault.createPendingAuth(entry.id, {
          appId: 'slack',
          authUrl: 'https://example.com/auth',
          ttlMs: -1000, // Already expired
        });

        const retrieved = await vault.getPendingAuth(entry.id, pending.id);
        expect(retrieved?.status).toBe('expired');
      });
    });

    describe('cleanup', () => {
      it('should clean up expired pending auths', async () => {
        const entry = await vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        });

        // Create expired pending auth
        await vault.createPendingAuth(entry.id, {
          appId: 'slack',
          authUrl: 'https://example.com/auth',
          ttlMs: -1000, // Already expired
        });

        // Create valid pending auth
        await vault.createPendingAuth(entry.id, {
          appId: 'github',
          authUrl: 'https://example.com/auth',
          ttlMs: 600000, // 10 minutes
        });

        await vault.cleanup();

        const pendings = await vault.getPendingAuths(entry.id);
        expect(pendings).toHaveLength(1);
        expect(pendings[0].appId).toBe('github');
      });
    });

    // ============================================
    // App Credential Tests
    // ============================================

    describe('App Credentials', () => {
      describe('addAppCredential', () => {
        it('should add an OAuth credential', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'test-slack-token',
              refreshToken: 'test-refresh',
              tokenType: 'Bearer',
              scopes: ['chat:write'],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          const retrieved = await vault.getCredential(entry.id, 'slack', 'slack-oauth');
          expect(retrieved).not.toBeNull();
          expect(retrieved?.credential.type).toBe('oauth');
          expect((retrieved?.credential as OAuthCredential).accessToken).toBe('test-slack-token');
        });

        it('should add an API key credential', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'openai',
            providerId: 'openai-api',
            credential: {
              type: 'api_key',
              key: 'test-api-key-1234',
              headerName: 'Authorization',
              headerPrefix: 'Bearer ',
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          const retrieved = await vault.getCredential(entry.id, 'openai', 'openai-api');
          expect(retrieved).not.toBeNull();
          expect(retrieved?.credential.type).toBe('api_key');
          expect((retrieved?.credential as ApiKeyCredential).key).toBe('test-api-key-1234');
        });

        it('should add a Basic Auth credential', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'legacy-api',
            providerId: 'basic-auth',
            credential: {
              type: 'basic',
              username: 'admin',
              password: 'secret123',
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          const retrieved = await vault.getCredential(entry.id, 'legacy-api', 'basic-auth');
          expect(retrieved).not.toBeNull();
          expect(retrieved?.credential.type).toBe('basic');
          expect((retrieved?.credential as BasicAuthCredential).username).toBe('admin');
        });

        it('should add a Private Key credential', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'jwt-service',
            providerId: 'jwt-signer',
            credential: {
              type: 'private_key',
              format: 'pem',
              keyData: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBAD...',
              algorithm: 'RS256',
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          const retrieved = await vault.getCredential(entry.id, 'jwt-service', 'jwt-signer');
          expect(retrieved).not.toBeNull();
          expect(retrieved?.credential.type).toBe('private_key');
          expect((retrieved?.credential as PrivateKeyCredential).format).toBe('pem');
        });

        it('should add an mTLS credential', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'mtls-service',
            providerId: 'mtls-client',
            credential: {
              type: 'mtls',
              certificate: '-----BEGIN CERTIFICATE-----',
              privateKey: '-----BEGIN PRIVATE KEY-----',
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          const retrieved = await vault.getCredential(entry.id, 'mtls-service', 'mtls-client');
          expect(retrieved).not.toBeNull();
          expect(retrieved?.credential.type).toBe('mtls');
        });

        it('should add a custom credential', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'aws',
            providerId: 'aws-sigv4',
            credential: {
              type: 'custom',
              customType: 'aws-sigv4',
              data: {
                accessKeyId: 'AKIA...',
                secretAccessKey: 'secret...',
                region: 'us-east-1',
              },
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          const retrieved = await vault.getCredential(entry.id, 'aws', 'aws-sigv4');
          expect(retrieved).not.toBeNull();
          expect(retrieved?.credential.type).toBe('custom');
          expect((retrieved?.credential as CustomCredential).customType).toBe('aws-sigv4');
        });

        it('should overwrite existing credential for same app and provider', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential1: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'old-token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now() - 1000,
            isValid: true,
          };

          const credential2: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'new-token',
              tokenType: 'Bearer',
              scopes: ['chat:write'],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential1);
          await vault.addAppCredential(entry.id, credential2);

          const retrieved = await vault.getCredential(entry.id, 'slack', 'slack-oauth');
          expect((retrieved?.credential as OAuthCredential).accessToken).toBe('new-token');
        });

        it('should not add credential if vault does not exist', async () => {
          const credential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential('non-existent', credential);

          const retrieved = await vault.getCredential('non-existent', 'slack', 'slack-oauth');
          expect(retrieved).toBeNull();
        });
      });

      describe('removeAppCredential', () => {
        it('should remove an existing credential', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);
          await vault.removeAppCredential(entry.id, 'slack', 'slack-oauth');

          const retrieved = await vault.getCredential(entry.id, 'slack', 'slack-oauth');
          expect(retrieved).toBeNull();
        });

        it('should not throw when removing non-existent credential', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          await expect(vault.removeAppCredential(entry.id, 'non-existent', 'provider')).resolves.not.toThrow();
        });
      });

      describe('getAppCredentials', () => {
        it('should get all credentials for an app', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const oauthCredential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'oauth-token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          const apiKeyCredential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-api',
            credential: {
              type: 'api_key',
              key: 'api-key',
              headerName: 'X-API-Key',
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          const otherAppCredential: AppCredential = {
            appId: 'github',
            providerId: 'github-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'github-token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, oauthCredential);
          await vault.addAppCredential(entry.id, apiKeyCredential);
          await vault.addAppCredential(entry.id, otherAppCredential);

          const slackCredentials = await vault.getAppCredentials(entry.id, 'slack');
          expect(slackCredentials).toHaveLength(2);
          expect(slackCredentials.map((c) => c.providerId)).toContain('slack-oauth');
          expect(slackCredentials.map((c) => c.providerId)).toContain('slack-api');
        });

        it('should return empty array for app with no credentials', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credentials = await vault.getAppCredentials(entry.id, 'no-credentials');
          expect(credentials).toEqual([]);
        });

        it('should return empty array for non-existent vault', async () => {
          const credentials = await vault.getAppCredentials('non-existent', 'slack');
          expect(credentials).toEqual([]);
        });
      });

      describe('getAllCredentials', () => {
        it('should get all credentials without consent filtering', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential1: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token1',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          const credential2: AppCredential = {
            appId: 'github',
            providerId: 'github-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token2',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential1);
          await vault.addAppCredential(entry.id, credential2);

          const allCredentials = await vault.getAllCredentials(entry.id);
          expect(allCredentials).toHaveLength(2);
        });

        it('should filter credentials by consent when enabled', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
            consent: {
              enabled: true,
              selectedToolIds: ['slack:send_message', 'slack:list_channels'],
              availableToolIds: ['slack:send_message', 'slack:list_channels', 'github:create_issue'],
              consentedAt: Date.now(),
              version: '1.0',
            },
          });

          const slackCredential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'slack-token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          const githubCredential: AppCredential = {
            appId: 'github',
            providerId: 'github-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'github-token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          // Manually add credentials bypassing consent check for testing
          const vaultEntry = await vault.get(entry.id);
          vaultEntry!.appCredentials = {
            'slack:slack-oauth': slackCredential,
            'github:github-oauth': githubCredential,
          };

          const filteredCredentials = await vault.getAllCredentials(entry.id, true);
          expect(filteredCredentials).toHaveLength(1);
          expect(filteredCredentials[0].appId).toBe('slack');
        });

        it('should return all credentials when consent is disabled', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
            consent: {
              enabled: false,
              selectedToolIds: [],
              availableToolIds: [],
              consentedAt: Date.now(),
              version: '1.0',
            },
          });

          const credential1: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token1',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          const credential2: AppCredential = {
            appId: 'github',
            providerId: 'github-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token2',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential1);
          await vault.addAppCredential(entry.id, credential2);

          const allCredentials = await vault.getAllCredentials(entry.id, true);
          expect(allCredentials).toHaveLength(2);
        });
      });

      describe('updateCredential', () => {
        it('should update lastUsedAt', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now() - 1000,
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          const newLastUsedAt = Date.now();
          await vault.updateCredential(entry.id, 'slack', 'slack-oauth', {
            lastUsedAt: newLastUsedAt,
          });

          const retrieved = await vault.getCredential(entry.id, 'slack', 'slack-oauth');
          expect(retrieved?.lastUsedAt).toBe(newLastUsedAt);
        });

        it('should update isValid and invalidReason', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          await vault.updateCredential(entry.id, 'slack', 'slack-oauth', {
            isValid: false,
            invalidReason: 'Token revoked by user',
          });

          const retrieved = await vault.getCredential(entry.id, 'slack', 'slack-oauth');
          expect(retrieved?.isValid).toBe(false);
          expect(retrieved?.invalidReason).toBe('Token revoked by user');
        });

        it('should update metadata', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          await vault.updateCredential(entry.id, 'slack', 'slack-oauth', {
            metadata: { teamId: 'T123', teamName: 'My Team' },
          });

          const retrieved = await vault.getCredential(entry.id, 'slack', 'slack-oauth');
          expect(retrieved?.metadata).toEqual({ teamId: 'T123', teamName: 'My Team' });
        });
      });

      describe('shouldStoreCredential', () => {
        it('should return true when consent is not set', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const shouldStore = await vault.shouldStoreCredential(entry.id, 'slack');
          expect(shouldStore).toBe(true);
        });

        it('should return true when consent is disabled', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
            consent: {
              enabled: false,
              selectedToolIds: [],
              availableToolIds: [],
              consentedAt: Date.now(),
              version: '1.0',
            },
          });

          const shouldStore = await vault.shouldStoreCredential(entry.id, 'slack');
          expect(shouldStore).toBe(true);
        });

        it('should return true when app has tools in consent selection', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
            consent: {
              enabled: true,
              selectedToolIds: ['slack:send_message', 'github:create_issue'],
              availableToolIds: ['slack:send_message', 'github:create_issue', 'jira:create_task'],
              consentedAt: Date.now(),
              version: '1.0',
            },
          });

          const shouldStore = await vault.shouldStoreCredential(entry.id, 'slack');
          expect(shouldStore).toBe(true);
        });

        it('should return false when app has no tools in consent selection', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
            consent: {
              enabled: true,
              selectedToolIds: ['github:create_issue'],
              availableToolIds: ['slack:send_message', 'github:create_issue'],
              consentedAt: Date.now(),
              version: '1.0',
            },
          });

          const shouldStore = await vault.shouldStoreCredential(entry.id, 'slack');
          expect(shouldStore).toBe(false);
        });

        it('should return true when specific toolIds match consent', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
            consent: {
              enabled: true,
              selectedToolIds: ['slack:send_message'],
              availableToolIds: ['slack:send_message', 'slack:list_channels'],
              consentedAt: Date.now(),
              version: '1.0',
            },
          });

          const shouldStore = await vault.shouldStoreCredential(entry.id, 'slack', ['slack:send_message']);
          expect(shouldStore).toBe(true);
        });

        it('should return false when specific toolIds do not match consent', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
            consent: {
              enabled: true,
              selectedToolIds: ['slack:send_message'],
              availableToolIds: ['slack:send_message', 'slack:list_channels'],
              consentedAt: Date.now(),
              version: '1.0',
            },
          });

          const shouldStore = await vault.shouldStoreCredential(entry.id, 'slack', ['slack:list_channels']);
          expect(shouldStore).toBe(false);
        });

        it('should return false for non-existent vault', async () => {
          const shouldStore = await vault.shouldStoreCredential('non-existent', 'slack');
          expect(shouldStore).toBe(false);
        });
      });

      describe('invalidateCredential', () => {
        it('should mark credential as invalid with reason', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);
          await vault.invalidateCredential(entry.id, 'slack', 'slack-oauth', 'Token expired');

          const retrieved = await vault.getCredential(entry.id, 'slack', 'slack-oauth');
          expect(retrieved?.isValid).toBe(false);
          expect(retrieved?.invalidReason).toBe('Token expired');
        });
      });

      describe('refreshOAuthCredential', () => {
        it('should update OAuth tokens', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'old-access-token',
              refreshToken: 'old-refresh-token',
              tokenType: 'Bearer',
              expiresAt: Date.now() - 1000, // Expired
              scopes: ['chat:write'],
            },
            acquiredAt: Date.now() - 3600000,
            isValid: false,
            invalidReason: 'Token expired',
          };

          await vault.addAppCredential(entry.id, credential);

          const newExpiresAt = Date.now() + 3600000;
          await vault.refreshOAuthCredential(entry.id, 'slack', 'slack-oauth', {
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            expiresAt: newExpiresAt,
          });

          const retrieved = await vault.getCredential(entry.id, 'slack', 'slack-oauth');
          expect(retrieved?.isValid).toBe(true);
          expect(retrieved?.invalidReason).toBeUndefined();
          expect((retrieved?.credential as OAuthCredential).accessToken).toBe('new-access-token');
          expect((retrieved?.credential as OAuthCredential).refreshToken).toBe('new-refresh-token');
          expect((retrieved?.credential as OAuthCredential).expiresAt).toBe(newExpiresAt);
          expect(retrieved?.expiresAt).toBe(newExpiresAt);
        });

        it('should update only access token if refresh token not provided', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'old-access-token',
              refreshToken: 'original-refresh-token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          await vault.refreshOAuthCredential(entry.id, 'slack', 'slack-oauth', {
            accessToken: 'new-access-token',
          });

          const retrieved = await vault.getCredential(entry.id, 'slack', 'slack-oauth');
          expect((retrieved?.credential as OAuthCredential).accessToken).toBe('new-access-token');
          expect((retrieved?.credential as OAuthCredential).refreshToken).toBe('original-refresh-token');
        });

        it('should not update non-OAuth credentials', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
          });

          const credential: AppCredential = {
            appId: 'openai',
            providerId: 'openai-api',
            credential: {
              type: 'api_key',
              key: 'sk-original-key',
              headerName: 'Authorization',
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          await vault.refreshOAuthCredential(entry.id, 'openai', 'openai-api', {
            accessToken: 'should-not-apply',
          });

          const retrieved = await vault.getCredential(entry.id, 'openai', 'openai-api');
          expect(retrieved?.credential.type).toBe('api_key');
          expect((retrieved?.credential as ApiKeyCredential).key).toBe('sk-original-key');
        });
      });

      describe('Consent-based credential storage', () => {
        it('should not store credential when consent blocks the app', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
            consent: {
              enabled: true,
              selectedToolIds: ['github:create_issue'],
              availableToolIds: ['slack:send_message', 'github:create_issue'],
              consentedAt: Date.now(),
              version: '1.0',
            },
          });

          const credential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          const retrieved = await vault.getCredential(entry.id, 'slack', 'slack-oauth');
          expect(retrieved).toBeNull();
        });

        it('should store credential when consent allows the app', async () => {
          const entry = await vault.create({
            userSub: 'user-123',
            clientId: 'client-456',
            consent: {
              enabled: true,
              selectedToolIds: ['slack:send_message', 'github:create_issue'],
              availableToolIds: ['slack:send_message', 'github:create_issue'],
              consentedAt: Date.now(),
              version: '1.0',
            },
          });

          const credential: AppCredential = {
            appId: 'slack',
            providerId: 'slack-oauth',
            credential: {
              type: 'oauth',
              accessToken: 'token',
              tokenType: 'Bearer',
              scopes: [],
            },
            acquiredAt: Date.now(),
            isValid: true,
          };

          await vault.addAppCredential(entry.id, credential);

          const retrieved = await vault.getCredential(entry.id, 'slack', 'slack-oauth');
          expect(retrieved).not.toBeNull();
        });
      });
    });
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe('Integration', () => {
    let vault: AuthorizationVault;

    beforeEach(() => {
      vault = new InMemoryAuthorizationVault();
    });

    it('should handle full authorization flow', async () => {
      // 1. Create vault entry with initial consent and federated login
      const entry = await vault.create({
        userSub: 'user-123',
        userEmail: 'user@example.com',
        clientId: 'client-456',
        consent: {
          enabled: true,
          selectedToolIds: ['slack:send_message'],
          availableToolIds: ['slack:send_message', 'github:create_issue'],
          consentedAt: Date.now(),
          version: '1.0',
        },
        federated: {
          selectedProviderIds: ['local'],
          skippedProviderIds: ['slack-auth', 'github-auth'],
          primaryProviderId: 'local',
          completedAt: Date.now(),
        },
        authorizedAppIds: [],
        skippedAppIds: ['slack', 'github'],
      });

      expect(await vault.isAppAuthorized(entry.id, 'slack')).toBe(false);

      // 2. User tries to use slack tool - create pending auth
      const pending = await vault.createPendingAuth(entry.id, {
        appId: 'slack',
        toolId: 'slack:send_message',
        authUrl: 'https://example.com/oauth/authorize?app=slack',
        requiredScopes: ['chat:write'],
        elicitId: 'elicit-789',
      });

      expect(pending.status).toBe('pending');

      // 3. User completes authorization
      await vault.completePendingAuth(entry.id, pending.id);

      // 4. App should now be authorized
      expect(await vault.isAppAuthorized(entry.id, 'slack')).toBe(true);

      // 5. Verify final state
      const finalEntry = await vault.get(entry.id);
      expect(finalEntry?.authorizedAppIds).toContain('slack');
      expect(finalEntry?.skippedAppIds).not.toContain('slack');
    });

    it('should handle cancelled authorization', async () => {
      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-456',
        skippedAppIds: ['slack'],
      });

      const pending = await vault.createPendingAuth(entry.id, {
        appId: 'slack',
        authUrl: 'https://example.com/auth',
        elicitId: 'elicit-123',
      });

      // User cancels
      await vault.cancelPendingAuth(entry.id, pending.id);

      // App should still be skipped
      expect(await vault.isAppAuthorized(entry.id, 'slack')).toBe(false);

      const finalEntry = await vault.get(entry.id);
      expect(finalEntry?.skippedAppIds).toContain('slack');
    });

    it('should handle multiple concurrent pending auths', async () => {
      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-456',
        skippedAppIds: ['slack', 'github', 'jira'],
      });

      // Create multiple pending auths
      const [slackPending, githubPending, jiraPending] = await Promise.all([
        vault.createPendingAuth(entry.id, {
          appId: 'slack',
          authUrl: 'https://example.com/auth/slack',
        }),
        vault.createPendingAuth(entry.id, {
          appId: 'github',
          authUrl: 'https://example.com/auth/github',
        }),
        vault.createPendingAuth(entry.id, {
          appId: 'jira',
          authUrl: 'https://example.com/auth/jira',
        }),
      ]);

      // Complete slack, cancel github, leave jira pending
      await vault.completePendingAuth(entry.id, slackPending.id);
      await vault.cancelPendingAuth(entry.id, githubPending.id);

      expect(await vault.isAppAuthorized(entry.id, 'slack')).toBe(true);
      expect(await vault.isAppAuthorized(entry.id, 'github')).toBe(false);
      expect(await vault.isAppAuthorized(entry.id, 'jira')).toBe(false);

      const pendings = await vault.getPendingAuths(entry.id);
      expect(pendings).toHaveLength(1);
      expect(pendings[0].appId).toBe('jira');
    });
  });
});
