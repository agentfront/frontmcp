import { OpenApiAdapterOptions } from './openapi.types';

describe('OpenApiAdapterOptions', () => {
  describe('type validation', () => {
    it('should accept valid options with name and url', () => {
      const options: OpenApiAdapterOptions = {
        name: 'myApi',
        url: 'https://api.example.com/openapi.json',
      };

      expect(options.name).toBe('myApi');
      expect(options.url).toBe('https://api.example.com/openapi.json');
    });

    it('should accept empty string for name', () => {
      const options: OpenApiAdapterOptions = {
        name: '',
        url: 'https://api.example.com',
      };

      expect(options.name).toBe('');
    });

    it('should accept various URL formats', () => {
      const httpOptions: OpenApiAdapterOptions = {
        name: 'api1',
        url: 'http://localhost:3000/openapi.json',
      };

      const httpsOptions: OpenApiAdapterOptions = {
        name: 'api2',
        url: 'https://api.example.com/v1/openapi.yaml',
      };

      const fileOptions: OpenApiAdapterOptions = {
        name: 'api3',
        url: 'file:///path/to/openapi.json',
      };

      expect(httpOptions.url).toContain('http://');
      expect(httpsOptions.url).toContain('https://');
      expect(fileOptions.url).toContain('file://');
    });

    it('should support complex names', () => {
      const options: OpenApiAdapterOptions = {
        name: 'my-api-v2',
        url: 'https://api.example.com',
      };

      expect(options.name).toBe('my-api-v2');
    });

    it('should support names with special characters', () => {
      const options: OpenApiAdapterOptions = {
        name: 'api_v1.2.3',
        url: 'https://api.example.com',
      };

      expect(options.name).toBe('api_v1.2.3');
    });
  });

  describe('real-world usage scenarios', () => {
    it('should work with OpenAPI spec URLs', () => {
      const options: OpenApiAdapterOptions = {
        name: 'petstore',
        url: 'https://petstore3.swagger.io/api/v3/openapi.json',
      };

      expect(options).toHaveProperty('name');
      expect(options).toHaveProperty('url');
    });

    it('should work with local file paths', () => {
      const options: OpenApiAdapterOptions = {
        name: 'local-api',
        url: './specs/openapi.yaml',
      };

      expect(options.url).toContain('openapi.yaml');
    });

    it('should support versioned APIs', () => {
      const v1Options: OpenApiAdapterOptions = {
        name: 'api-v1',
        url: 'https://api.example.com/v1/openapi.json',
      };

      const v2Options: OpenApiAdapterOptions = {
        name: 'api-v2',
        url: 'https://api.example.com/v2/openapi.json',
      };

      expect(v1Options.name).not.toBe(v2Options.name);
      expect(v1Options.url).not.toBe(v2Options.url);
    });

    it('should support different environments', () => {
      const devOptions: OpenApiAdapterOptions = {
        name: 'dev-api',
        url: 'https://dev-api.example.com/openapi.json',
      };

      const prodOptions: OpenApiAdapterOptions = {
        name: 'prod-api',
        url: 'https://api.example.com/openapi.json',
      };

      expect(devOptions.url).toContain('dev-api');
      expect(prodOptions.url).not.toContain('dev-api');
    });

    it('should handle URLs with query parameters', () => {
      const options: OpenApiAdapterOptions = {
        name: 'api-with-params',
        url: 'https://api.example.com/openapi.json?version=3.0&format=json',
      };

      expect(options.url).toContain('?');
      expect(options.url).toContain('version=3.0');
    });

    it('should handle URLs with authentication tokens in path', () => {
      const options: OpenApiAdapterOptions = {
        name: 'authenticated-api',
        url: 'https://api.example.com/specs/abc123/openapi.json',
      };

      expect(options.url).toContain('abc123');
    });
  });

  describe('edge cases', () => {
    it('should handle very long names', () => {
      const longName = 'a'.repeat(200);
      const options: OpenApiAdapterOptions = {
        name: longName,
        url: 'https://api.example.com',
      };

      expect(options.name.length).toBe(200);
    });

    it('should handle very long URLs', () => {
      const longUrl = 'https://api.example.com/' + 'a'.repeat(1000) + '/openapi.json';
      const options: OpenApiAdapterOptions = {
        name: 'api',
        url: longUrl,
      };

      expect(options.url.length).toBeGreaterThan(1000);
    });

    it('should handle names with unicode characters', () => {
      const options: OpenApiAdapterOptions = {
        name: 'api-测试-🚀',
        url: 'https://api.example.com',
      };

      expect(options.name).toContain('测试');
      expect(options.name).toContain('🚀');
    });

    it('should handle URLs with unicode characters', () => {
      const options: OpenApiAdapterOptions = {
        name: 'api',
        url: 'https://api.example.com/测试/openapi.json',
      };

      expect(options.url).toContain('测试');
    });

    it('should be serializable to JSON', () => {
      const options: OpenApiAdapterOptions = {
        name: 'json-test',
        url: 'https://api.example.com',
      };

      const json = JSON.stringify(options);
      const parsed = JSON.parse(json);

      expect(parsed.name).toBe(options.name);
      expect(parsed.url).toBe(options.url);
    });

    it('should support object spreading', () => {
      const baseOptions: OpenApiAdapterOptions = {
        name: 'base',
        url: 'https://api.example.com',
      };

      const extendedOptions = {
        ...baseOptions,
        name: 'extended',
      };

      expect(extendedOptions.name).toBe('extended');
      expect(extendedOptions.url).toBe(baseOptions.url);
    });
  });

  describe('type safety', () => {
    it('should enforce required properties at compile time', () => {
      // This test validates TypeScript compilation
      // The following would not compile if name or url were missing:
      const valid: OpenApiAdapterOptions = {
        name: 'test',
        url: 'https://api.example.com',
      };

      expect(valid).toBeDefined();
    });

    it('should not allow additional properties to break type', () => {
      const options: OpenApiAdapterOptions = {
        name: 'test',
        url: 'https://api.example.com',
        // Additional properties would not be typed but JavaScript allows them
      };

      expect(options.name).toBe('test');
      expect(options.url).toBe('https://api.example.com');
    });

    it('should work with type guards', () => {
      const isOpenApiOptions = (obj: any): obj is OpenApiAdapterOptions => {
        return (
          typeof obj === 'object' &&
          obj !== null &&
          typeof obj.name === 'string' &&
          typeof obj.url === 'string'
        );
      };

      const valid = { name: 'test', url: 'https://api.example.com' };
      const invalid = { name: 'test' };

      expect(isOpenApiOptions(valid)).toBe(true);
      expect(isOpenApiOptions(invalid)).toBe(false);
    });

    it('should work in arrays', () => {
      const options: OpenApiAdapterOptions[] = [
        { name: 'api1', url: 'https://api1.example.com' },
        { name: 'api2', url: 'https://api2.example.com' },
      ];

      expect(options).toHaveLength(2);
      expect(options[0].name).toBe('api1');
      expect(options[1].name).toBe('api2');
    });

    it('should work in maps', () => {
      const optionsMap = new Map<string, OpenApiAdapterOptions>();
      optionsMap.set('api1', { name: 'api1', url: 'https://api1.example.com' });
      optionsMap.set('api2', { name: 'api2', url: 'https://api2.example.com' });

      expect(optionsMap.size).toBe(2);
      expect(optionsMap.get('api1')?.url).toBe('https://api1.example.com');
    });
  });
});