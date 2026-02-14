import { NullOrchestratedAuthAccessor, OrchestratedAuthAccessorAdapter } from '../authorization/orchestrated.accessor';
import { OrchestratedAuthNotAvailableError } from '../errors';

describe('NullOrchestratedAuthAccessor', () => {
  let accessor: NullOrchestratedAuthAccessor;

  beforeEach(() => {
    accessor = new NullOrchestratedAuthAccessor();
  });

  describe('properties', () => {
    it('should return undefined for primaryProviderId', () => {
      expect(accessor.primaryProviderId).toBeUndefined();
    });

    it('should return undefined for issuer', () => {
      expect(accessor.issuer).toBeUndefined();
    });

    it('should return null for authorizationId', () => {
      expect(accessor.authorizationId).toBe('null');
    });

    it('should return false for isAuthenticated', () => {
      expect(accessor.isAuthenticated).toBe(false);
    });
  });

  describe('getToken', () => {
    it('should throw error', async () => {
      await expect(accessor.getToken()).rejects.toThrow(OrchestratedAuthNotAvailableError);
    });

    it('should throw error with providerId', async () => {
      await expect(accessor.getToken('github')).rejects.toThrow(OrchestratedAuthNotAvailableError);
    });
  });

  describe('tryGetToken', () => {
    it('should return null', async () => {
      const token = await accessor.tryGetToken();
      expect(token).toBeNull();
    });

    it('should return null with providerId', async () => {
      const token = await accessor.tryGetToken('github');
      expect(token).toBeNull();
    });
  });

  describe('getAppToken', () => {
    it('should return null', async () => {
      const token = await accessor.getAppToken('myapp');
      expect(token).toBeNull();
    });
  });

  describe('hasProvider', () => {
    it('should return false', () => {
      expect(accessor.hasProvider('github')).toBe(false);
    });
  });

  describe('getProviderIds', () => {
    it('should return empty array', () => {
      expect(accessor.getProviderIds()).toEqual([]);
    });
  });

  describe('isAppAuthorized', () => {
    it('should return false', () => {
      expect(accessor.isAppAuthorized('myapp')).toBe(false);
    });
  });

  describe('getAllAuthorizedAppIds', () => {
    it('should return empty array', () => {
      expect(accessor.getAllAuthorizedAppIds()).toEqual([]);
    });
  });

  describe('getAppToolIds', () => {
    it('should return undefined', () => {
      expect(accessor.getAppToolIds('myapp')).toBeUndefined();
    });
  });
});

describe('OrchestratedAuthAccessorAdapter', () => {
  const mockAuthorization = {
    id: 'auth-123',
    isAnonymous: false,
    primaryProviderId: 'github',
    issuer: 'http://localhost:3000',
    hasProvider: jest.fn(),
    getProviderIds: jest.fn(),
    getToken: jest.fn(),
    getAppToken: jest.fn(),
    isAppAuthorized: jest.fn(),
    getAllAuthorizedAppIds: jest.fn(),
    getAppToolIds: jest.fn(),
  };

  let adapter: OrchestratedAuthAccessorAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new OrchestratedAuthAccessorAdapter(mockAuthorization);
  });

  describe('properties', () => {
    it('should return primaryProviderId', () => {
      expect(adapter.primaryProviderId).toBe('github');
    });

    it('should return issuer', () => {
      expect(adapter.issuer).toBe('http://localhost:3000');
    });

    it('should return authorizationId', () => {
      expect(adapter.authorizationId).toBe('auth-123');
    });

    it('should return true for isAuthenticated when not anonymous', () => {
      expect(adapter.isAuthenticated).toBe(true);
    });

    it('should return false for isAuthenticated when anonymous', () => {
      const anonAdapter = new OrchestratedAuthAccessorAdapter({
        ...mockAuthorization,
        isAnonymous: true,
      });
      expect(anonAdapter.isAuthenticated).toBe(false);
    });
  });

  describe('getToken', () => {
    it('should delegate to authorization', async () => {
      mockAuthorization.getToken.mockResolvedValue('gho_token');

      const token = await adapter.getToken('github');

      expect(mockAuthorization.getToken).toHaveBeenCalledWith('github');
      expect(token).toBe('gho_token');
    });

    it('should call without providerId', async () => {
      mockAuthorization.getToken.mockResolvedValue('default_token');

      const token = await adapter.getToken();

      expect(mockAuthorization.getToken).toHaveBeenCalledWith(undefined);
      expect(token).toBe('default_token');
    });
  });

  describe('tryGetToken', () => {
    it('should return token on success', async () => {
      mockAuthorization.getToken.mockResolvedValue('gho_token');

      const token = await adapter.tryGetToken('github');

      expect(token).toBe('gho_token');
    });

    it('should return null on error', async () => {
      mockAuthorization.getToken.mockRejectedValue(new Error('No token'));

      const token = await adapter.tryGetToken('github');

      expect(token).toBeNull();
    });
  });

  describe('getAppToken', () => {
    it('should delegate to authorization', async () => {
      mockAuthorization.getAppToken.mockResolvedValue('app_token');

      const token = await adapter.getAppToken('myapp');

      expect(mockAuthorization.getAppToken).toHaveBeenCalledWith('myapp');
      expect(token).toBe('app_token');
    });
  });

  describe('hasProvider', () => {
    it('should delegate to authorization', () => {
      mockAuthorization.hasProvider.mockReturnValue(true);

      const has = adapter.hasProvider('github');

      expect(mockAuthorization.hasProvider).toHaveBeenCalledWith('github');
      expect(has).toBe(true);
    });
  });

  describe('getProviderIds', () => {
    it('should delegate to authorization', () => {
      mockAuthorization.getProviderIds.mockReturnValue(['github', 'slack']);

      const ids = adapter.getProviderIds();

      expect(mockAuthorization.getProviderIds).toHaveBeenCalled();
      expect(ids).toEqual(['github', 'slack']);
    });
  });

  describe('isAppAuthorized', () => {
    it('should delegate to authorization', () => {
      mockAuthorization.isAppAuthorized.mockReturnValue(true);

      const authorized = adapter.isAppAuthorized('myapp');

      expect(mockAuthorization.isAppAuthorized).toHaveBeenCalledWith('myapp');
      expect(authorized).toBe(true);
    });
  });

  describe('getAllAuthorizedAppIds', () => {
    it('should delegate to authorization', () => {
      mockAuthorization.getAllAuthorizedAppIds.mockReturnValue(['app1', 'app2']);

      const ids = adapter.getAllAuthorizedAppIds();

      expect(mockAuthorization.getAllAuthorizedAppIds).toHaveBeenCalled();
      expect(ids).toEqual(['app1', 'app2']);
    });
  });

  describe('getAppToolIds', () => {
    it('should delegate to authorization', () => {
      mockAuthorization.getAppToolIds.mockReturnValue(['tool1', 'tool2']);

      const ids = adapter.getAppToolIds('myapp');

      expect(mockAuthorization.getAppToolIds).toHaveBeenCalledWith('myapp');
      expect(ids).toEqual(['tool1', 'tool2']);
    });

    it('should return undefined when not found', () => {
      mockAuthorization.getAppToolIds.mockReturnValue(undefined);

      const ids = adapter.getAppToolIds('unknown');

      expect(ids).toBeUndefined();
    });
  });
});
