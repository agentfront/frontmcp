// file: plugins/plugin-dashboard/src/__tests__/dashboard.symbol.test.ts

import 'reflect-metadata';
import { DashboardConfigToken, GraphDataProviderToken, ParentScopeToken } from '../dashboard.symbol';

describe('Dashboard Symbols', () => {
  describe('DashboardConfigToken', () => {
    it('should be a symbol', () => {
      expect(typeof DashboardConfigToken).toBe('symbol');
    });

    it('should have correct description', () => {
      expect(DashboardConfigToken.toString()).toContain('DashboardConfig');
    });
  });

  describe('GraphDataProviderToken', () => {
    it('should be a symbol', () => {
      expect(typeof GraphDataProviderToken).toBe('symbol');
    });

    it('should have correct description', () => {
      expect(GraphDataProviderToken.toString()).toContain('GraphDataProvider');
    });
  });

  describe('ParentScopeToken', () => {
    it('should be a symbol', () => {
      expect(typeof ParentScopeToken).toBe('symbol');
    });

    it('should have correct description', () => {
      expect(ParentScopeToken.toString()).toContain('ParentScope');
    });
  });

  describe('symbol uniqueness', () => {
    it('should have unique symbols', () => {
      expect(DashboardConfigToken).not.toBe(GraphDataProviderToken);
      expect(DashboardConfigToken).not.toBe(ParentScopeToken);
      expect(GraphDataProviderToken).not.toBe(ParentScopeToken);
    });
  });
});
