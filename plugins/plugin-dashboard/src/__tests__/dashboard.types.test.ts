// file: plugins/plugin-dashboard/src/__tests__/dashboard.types.test.ts

import 'reflect-metadata';
import {
  cdnConfigSchema,
  dashboardAuthSchema,
  dashboardPluginOptionsSchema,
  defaultDashboardPluginOptions,
  isDashboardEnabled,
  type DashboardPluginOptions,
} from '../dashboard.types';

describe('Dashboard Types', () => {
  describe('cdnConfigSchema', () => {
    it('should have correct defaults', () => {
      const result = cdnConfigSchema.parse({});

      expect(result.react).toBe('https://esm.sh/react@19');
      expect(result.reactDom).toBe('https://esm.sh/react-dom@19');
      expect(result.reactDomClient).toBe('https://esm.sh/react-dom@19/client');
      expect(result.reactJsxRuntime).toBe('https://esm.sh/react@19/jsx-runtime');
      expect(result.reactRouter).toBe('https://esm.sh/react-router-dom@7');
      expect(result.xyflow).toBe('https://esm.sh/@xyflow/react@12?external=react,react-dom');
      expect(result.dagre).toBe('https://esm.sh/dagre@0.8.5');
      expect(result.xyflowCss).toBe('https://esm.sh/@xyflow/react@12/dist/style.css');
    });

    it('should allow custom CDN URLs', () => {
      const result = cdnConfigSchema.parse({
        react: 'https://cdn.example.com/react',
        entrypoint: 'https://cdn.example.com/dashboard-ui',
      });

      expect(result.react).toBe('https://cdn.example.com/react');
      expect(result.entrypoint).toBe('https://cdn.example.com/dashboard-ui');
    });

    it('should not require entrypoint', () => {
      const result = cdnConfigSchema.parse({});
      expect(result.entrypoint).toBeUndefined();
    });
  });

  describe('dashboardAuthSchema', () => {
    it('should have enabled=false by default', () => {
      const result = dashboardAuthSchema.parse({});
      expect(result.enabled).toBe(false);
      expect(result.token).toBeUndefined();
    });

    it('should accept enabled=true', () => {
      const result = dashboardAuthSchema.parse({ enabled: true });
      expect(result.enabled).toBe(true);
    });

    it('should accept token', () => {
      const result = dashboardAuthSchema.parse({ enabled: true, token: 'my-secret' });
      expect(result.token).toBe('my-secret');
    });
  });

  describe('dashboardPluginOptionsSchema', () => {
    it('should have correct defaults', () => {
      const result = dashboardPluginOptionsSchema.parse({});

      expect(result.basePath).toBe('/dashboard');
      expect(result.enabled).toBeUndefined();
      expect(result.auth.enabled).toBe(false);
      expect(result.cdn.react).toBe('https://esm.sh/react@19');
    });

    it('should accept custom basePath', () => {
      const result = dashboardPluginOptionsSchema.parse({ basePath: '/admin' });
      expect(result.basePath).toBe('/admin');
    });

    it('should accept enabled option', () => {
      const result = dashboardPluginOptionsSchema.parse({ enabled: true });
      expect(result.enabled).toBe(true);
    });

    it('should accept auth configuration', () => {
      const result = dashboardPluginOptionsSchema.parse({
        auth: { enabled: true, token: 'secret' },
      });
      expect(result.auth.enabled).toBe(true);
      expect(result.auth.token).toBe('secret');
    });

    it('should accept cdn configuration', () => {
      const result = dashboardPluginOptionsSchema.parse({
        cdn: { react: 'https://custom.cdn/react' },
      });
      expect(result.cdn.react).toBe('https://custom.cdn/react');
    });

    it('should transform undefined auth to defaults', () => {
      const result = dashboardPluginOptionsSchema.parse({});
      expect(result.auth).toBeDefined();
      expect(result.auth.enabled).toBe(false);
    });

    it('should transform undefined cdn to defaults', () => {
      const result = dashboardPluginOptionsSchema.parse({});
      expect(result.cdn).toBeDefined();
      expect(result.cdn.react).toBeDefined();
    });
  });

  describe('defaultDashboardPluginOptions', () => {
    it('should have correct values', () => {
      expect(defaultDashboardPluginOptions.basePath).toBe('/dashboard');
      expect(defaultDashboardPluginOptions.auth?.enabled).toBe(false);
      expect(defaultDashboardPluginOptions.cdn).toEqual({});
    });
  });

  describe('isDashboardEnabled', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return true when enabled is true', () => {
      const options = dashboardPluginOptionsSchema.parse({ enabled: true });
      expect(isDashboardEnabled(options)).toBe(true);
    });

    it('should return false when enabled is false', () => {
      const options = dashboardPluginOptionsSchema.parse({ enabled: false });
      expect(isDashboardEnabled(options)).toBe(false);
    });

    it('should return true in development mode when enabled is undefined', () => {
      process.env['NODE_ENV'] = 'development';
      const options = dashboardPluginOptionsSchema.parse({});
      expect(isDashboardEnabled(options)).toBe(true);
    });

    it('should return false in production mode when enabled is undefined', () => {
      process.env['NODE_ENV'] = 'production';
      const options = dashboardPluginOptionsSchema.parse({});
      expect(isDashboardEnabled(options)).toBe(false);
    });

    it('should return true when NODE_ENV is not set', () => {
      delete process.env['NODE_ENV'];
      const options = dashboardPluginOptionsSchema.parse({});
      expect(isDashboardEnabled(options)).toBe(true);
    });
  });
});
