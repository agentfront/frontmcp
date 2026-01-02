/**
 * Tests for DI constants.
 */

import { DESIGN_PARAMTYPES, META_ASYNC_WITH, META_ASYNC_WITH_TOKENS } from '../tokens/di.constants.js';

describe('DI Constants', () => {
  describe('DESIGN_PARAMTYPES', () => {
    it('should be the TypeScript design:paramtypes string', () => {
      expect(DESIGN_PARAMTYPES).toBe('design:paramtypes');
    });
  });

  describe('META_ASYNC_WITH', () => {
    it('should be a symbol', () => {
      expect(typeof META_ASYNC_WITH).toBe('symbol');
    });

    it('should have descriptive name', () => {
      expect(META_ASYNC_WITH.toString()).toBe('Symbol(di:async-with)');
    });
  });

  describe('META_ASYNC_WITH_TOKENS', () => {
    it('should be a symbol', () => {
      expect(typeof META_ASYNC_WITH_TOKENS).toBe('symbol');
    });

    it('should have descriptive name', () => {
      expect(META_ASYNC_WITH_TOKENS.toString()).toBe('Symbol(di:async-with-tokens)');
    });

    it('should be different from META_ASYNC_WITH', () => {
      expect(META_ASYNC_WITH_TOKENS).not.toBe(META_ASYNC_WITH);
    });
  });
});
