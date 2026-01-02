/**
 * Tests for token factory functionality.
 */

import { createTokenFactory, DiTokens, type TokenFactory } from '../tokens/token.factory.js';

describe('createTokenFactory', () => {
  describe('with default prefix', () => {
    let factory: TokenFactory;

    beforeEach(() => {
      factory = createTokenFactory();
    });

    it('should create type tokens with DI prefix', () => {
      const token = factory.type('MyService');
      expect(typeof token).toBe('symbol');
      expect(token.toString()).toBe('Symbol(DI:type:MyService)');
    });

    it('should create meta tokens with DI prefix', () => {
      const token = factory.meta('config');
      expect(typeof token).toBe('symbol');
      expect(token.toString()).toBe('Symbol(DI:meta:config)');
    });

    it('should create unique symbols for each call', () => {
      const token1 = factory.type('Service');
      const token2 = factory.type('Service');
      expect(token1).not.toBe(token2);
    });
  });

  describe('with custom prefix', () => {
    it('should use provided prefix for type tokens', () => {
      const factory = createTokenFactory({ prefix: 'Custom' });
      const token = factory.type('MyService');
      expect(token.toString()).toBe('Symbol(Custom:type:MyService)');
    });

    it('should use provided prefix for meta tokens', () => {
      const factory = createTokenFactory({ prefix: 'MyApp' });
      const token = factory.meta('setting');
      expect(token.toString()).toBe('Symbol(MyApp:meta:setting)');
    });

    it('should handle empty prefix', () => {
      const factory = createTokenFactory({ prefix: '' });
      const token = factory.type('Service');
      expect(token.toString()).toBe('Symbol(:type:Service)');
    });

    it('should handle special characters in prefix', () => {
      const factory = createTokenFactory({ prefix: '@frontmcp/sdk' });
      const token = factory.type('Tool');
      expect(token.toString()).toBe('Symbol(@frontmcp/sdk:type:Tool)');
    });
  });

  describe('with empty options', () => {
    it('should use DI as default prefix', () => {
      const factory = createTokenFactory({});
      const token = factory.type('Test');
      expect(token.toString()).toBe('Symbol(DI:type:Test)');
    });
  });
});

describe('DiTokens', () => {
  it('should be a pre-created token factory', () => {
    expect(DiTokens).toBeDefined();
    expect(typeof DiTokens.type).toBe('function');
    expect(typeof DiTokens.meta).toBe('function');
  });

  it('should create tokens with DI prefix', () => {
    const typeToken = DiTokens.type('Provider');
    const metaToken = DiTokens.meta('scope');

    expect(typeToken.toString()).toBe('Symbol(DI:type:Provider)');
    expect(metaToken.toString()).toBe('Symbol(DI:meta:scope)');
  });
});
