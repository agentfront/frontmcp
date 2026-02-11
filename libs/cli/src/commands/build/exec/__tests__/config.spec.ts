import { normalizeConfig, FrontmcpExecConfig } from '../config';

describe('config', () => {
  describe('normalizeConfig', () => {
    it('should accept valid config', () => {
      const config: FrontmcpExecConfig = {
        name: 'my-app',
        version: '1.2.3',
      };
      const result = normalizeConfig(config);
      expect(result.name).toBe('my-app');
      expect(result.version).toBe('1.2.3');
      expect(result.nodeVersion).toBe('>=22.0.0');
    });

    it('should set defaults for missing optional fields', () => {
      const config: FrontmcpExecConfig = {
        name: 'test',
      };
      const result = normalizeConfig(config);
      expect(result.version).toBe('1.0.0');
      expect(result.nodeVersion).toBe('>=22.0.0');
    });

    it('should reject invalid app name', () => {
      const config: FrontmcpExecConfig = {
        name: 'invalid name with spaces',
      };
      expect(() => normalizeConfig(config)).toThrow('Invalid app name');
    });

    it('should reject empty app name', () => {
      const config: FrontmcpExecConfig = {
        name: '',
      };
      expect(() => normalizeConfig(config)).toThrow('Invalid app name');
    });

    it('should accept name with dots, hyphens, underscores', () => {
      const config: FrontmcpExecConfig = {
        name: 'my-app_v1.0',
      };
      const result = normalizeConfig(config);
      expect(result.name).toBe('my-app_v1.0');
    });

    it('should preserve custom nodeVersion', () => {
      const config: FrontmcpExecConfig = {
        name: 'test',
        nodeVersion: '>=20.0.0',
      };
      const result = normalizeConfig(config);
      expect(result.nodeVersion).toBe('>=20.0.0');
    });
  });
});
