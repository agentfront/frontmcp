/**
 * OpenAPI Adapter validation tests
 */

import {
  validateSecurityConfiguration,
  extractSecuritySchemes,
} from '../openapi.security';
import type { McpOpenAPITool } from 'mcp-from-openapi';

describe('OpenapiAdapter - Validation', () => {
  describe('extractSecuritySchemes', () => {
    it('should extract security schemes from tools', () => {
      const tools: McpOpenAPITool[] = [
        {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object', properties: {} },
          mapper: [
            {
              inputKey: 'auth1',
              type: 'header',
              key: 'Authorization',
              required: true,
              security: {
                scheme: 'GitHubAuth',
                type: 'http',
                httpScheme: 'bearer',
              },
            },
          ],
          metadata: {
            path: '/path1',
            method: 'get',
          },
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          inputSchema: { type: 'object', properties: {} },
          mapper: [
            {
              inputKey: 'auth2',
              type: 'header',
              key: 'Authorization',
              required: true,
              security: {
                scheme: 'SlackAuth',
                type: 'http',
                httpScheme: 'bearer',
              },
            },
          ],
          metadata: {
            path: '/path2',
            method: 'get',
          },
        },
      ];

      const schemes = extractSecuritySchemes(tools);

      expect(schemes).toEqual(new Set(['GitHubAuth', 'SlackAuth']));
    });

    it('should handle tools without security', () => {
      const tools: McpOpenAPITool[] = [
        {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object', properties: {} },
          mapper: [
            {
              inputKey: 'id',
              type: 'path',
              key: 'id',
              required: true,
            },
          ],
          metadata: {
            path: '/path1',
            method: 'get',
          },
        },
      ];

      const schemes = extractSecuritySchemes(tools);

      expect(schemes.size).toBe(0);
    });
  });

  describe('validateSecurityConfiguration', () => {
    const mockToolWithAuth: McpOpenAPITool = {
      name: 'protectedTool',
      description: 'Protected',
      inputSchema: { type: 'object', properties: {} },
      mapper: [
        {
          inputKey: 'auth',
          type: 'header',
          key: 'Authorization',
          required: true,
          security: {
            scheme: 'BearerAuth',
            type: 'http',
            httpScheme: 'bearer',
          },
        },
      ],
      metadata: {
        path: '/protected',
        method: 'get',
      },
    };

    const mockToolWithoutAuth: McpOpenAPITool = {
      name: 'publicTool',
      description: 'Public',
      inputSchema: { type: 'object', properties: {} },
      mapper: [
        {
          inputKey: 'id',
          type: 'path',
          key: 'id',
          required: true,
        },
      ],
      metadata: {
        path: '/public',
        method: 'get',
      },
    };

    describe('Security Risk Scores', () => {
      it('should return LOW risk for authProviderMapper', () => {
        const result = validateSecurityConfiguration([mockToolWithAuth], {
          authProviderMapper: {
            BearerAuth: (authInfo) => authInfo.token,
          },
        });

        expect(result.securityRiskScore).toBe('low');
        expect(result.valid).toBe(true);
      });

      it('should return LOW risk for securityResolver', () => {
        const result = validateSecurityConfiguration([mockToolWithAuth], {
          securityResolver: (tool, authInfo) => ({ jwt: authInfo.token }),
        });

        expect(result.securityRiskScore).toBe('low');
        expect(result.valid).toBe(true);
      });

      it('should return MEDIUM risk for staticAuth', () => {
        const result = validateSecurityConfiguration([mockToolWithAuth], {
          staticAuth: {
            jwt: 'static-token',
          },
        });

        expect(result.securityRiskScore).toBe('medium');
        expect(result.valid).toBe(true);
      });

      it('should return MEDIUM risk for default behavior', () => {
        const result = validateSecurityConfiguration([mockToolWithAuth], {});

        expect(result.securityRiskScore).toBe('medium');
        expect(result.valid).toBe(true);
      });

      it('should return HIGH risk for includeSecurityInInput', () => {
        const result = validateSecurityConfiguration([mockToolWithAuth], {
          generateOptions: {
            includeSecurityInInput: true,
          },
        });

        expect(result.securityRiskScore).toBe('high');
        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.includes('SECURITY WARNING'))).toBe(true);
      });
    });

    describe('Missing Mappings', () => {
      it('should detect missing auth provider mappings', () => {
        const multiAuthTool: McpOpenAPITool = {
          name: 'multiTool',
          description: 'Multi',
          inputSchema: { type: 'object', properties: {} },
          mapper: [
            {
              inputKey: 'githubAuth',
              type: 'header',
              key: 'Authorization',
              required: true,
              security: {
                scheme: 'GitHubAuth',
                type: 'http',
                httpScheme: 'bearer',
              },
            },
            {
              inputKey: 'slackAuth',
              type: 'header',
              key: 'Authorization',
              required: true,
              security: {
                scheme: 'SlackAuth',
                type: 'http',
                httpScheme: 'bearer',
              },
            },
          ],
          metadata: {
            path: '/multi',
            method: 'get',
          },
        };

        const result = validateSecurityConfiguration([multiAuthTool], {
          authProviderMapper: {
            GitHubAuth: (authInfo) => authInfo.user?.githubToken,
            // SlackAuth is missing!
          },
        });

        expect(result.valid).toBe(false);
        expect(result.missingMappings).toContain('SlackAuth');
        expect(result.warnings.some((w) => w.includes('Missing auth provider mappings'))).toBe(true);
      });

      it('should pass with all mappings provided', () => {
        const multiAuthTool: McpOpenAPITool = {
          name: 'multiTool',
          description: 'Multi',
          inputSchema: { type: 'object', properties: {} },
          mapper: [
            {
              inputKey: 'githubAuth',
              type: 'header',
              key: 'Authorization',
              required: true,
              security: {
                scheme: 'GitHubAuth',
                type: 'http',
                httpScheme: 'bearer',
              },
            },
            {
              inputKey: 'slackAuth',
              type: 'header',
              key: 'Authorization',
              required: true,
              security: {
                scheme: 'SlackAuth',
                type: 'http',
                httpScheme: 'bearer',
              },
            },
          ],
          metadata: {
            path: '/multi',
            method: 'get',
          },
        };

        const result = validateSecurityConfiguration([multiAuthTool], {
          authProviderMapper: {
            GitHubAuth: (authInfo) => authInfo.user?.githubToken,
            SlackAuth: (authInfo) => authInfo.user?.slackToken,
          },
        });

        expect(result.valid).toBe(true);
        expect(result.missingMappings).toHaveLength(0);
      });
    });

    describe('Warnings and Info Messages', () => {
      it('should provide info for custom securityResolver', () => {
        const result = validateSecurityConfiguration([mockToolWithAuth], {
          securityResolver: (tool, authInfo) => ({ jwt: authInfo.token }),
        });

        expect(result.warnings.some((w) => w.includes('Using custom securityResolver'))).toBe(true);
      });

      it('should provide info for staticAuth', () => {
        const result = validateSecurityConfiguration([mockToolWithAuth], {
          staticAuth: { jwt: 'token' },
        });

        expect(result.warnings.some((w) => w.includes('Using staticAuth'))).toBe(true);
      });

      it('should provide recommendation for default behavior', () => {
        const result = validateSecurityConfiguration([mockToolWithAuth], {});

        expect(result.warnings.some((w) => w.includes('No auth configuration provided'))).toBe(true);
        expect(result.warnings.some((w) => w.includes('RECOMMENDATION'))).toBe(true);
      });

      it('should warn about security risk with includeSecurityInInput', () => {
        const result = validateSecurityConfiguration([mockToolWithAuth], {
          generateOptions: {
            includeSecurityInInput: true,
          },
        });

        expect(result.warnings.some((w) => w.includes('credentials may be logged or exposed'))).toBe(true);
      });
    });

    describe('No Security Required', () => {
      it('should pass validation for public endpoints', () => {
        const result = validateSecurityConfiguration([mockToolWithoutAuth], {});

        expect(result.valid).toBe(true);
        expect(result.securityRiskScore).toBe('low');
        expect(result.warnings).toHaveLength(0);
      });
    });
  });
});
