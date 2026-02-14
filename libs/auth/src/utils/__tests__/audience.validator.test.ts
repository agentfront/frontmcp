/**
 * Audience Validator Tests
 *
 * Tests for JWT audience validation per RFC 7519 and MCP Authorization spec.
 */
import {
  validateAudience,
  createAudienceValidator,
  deriveExpectedAudience,
  AudienceValidator,
} from '../audience.validator';

describe('validateAudience', () => {
  describe('basic matching', () => {
    it('should return valid when single expected matches single token audience', () => {
      const result = validateAudience('https://api.example.com', {
        expectedAudiences: ['https://api.example.com'],
      });
      expect(result.valid).toBe(true);
      expect(result.matchedAudience).toBe('https://api.example.com');
    });

    it('should return valid when one of multiple token audiences matches', () => {
      const result = validateAudience(['aud1', 'aud2', 'aud3'], {
        expectedAudiences: ['aud2'],
      });
      expect(result.valid).toBe(true);
      expect(result.matchedAudience).toBe('aud2');
    });

    it('should return valid when token audience matches one of multiple expected', () => {
      const result = validateAudience('aud-b', {
        expectedAudiences: ['aud-a', 'aud-b', 'aud-c'],
      });
      expect(result.valid).toBe(true);
      expect(result.matchedAudience).toBe('aud-b');
    });

    it('should return invalid when no match is found', () => {
      const result = validateAudience('wrong-aud', {
        expectedAudiences: ['expected-aud'],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Token audience does not match expected audiences');
      expect(result.error).toContain('wrong-aud');
      expect(result.error).toContain('expected-aud');
    });

    it('should return invalid with descriptive error listing all values', () => {
      const result = validateAudience(['a', 'b'], {
        expectedAudiences: ['x', 'y'],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Got: a, b');
      expect(result.error).toContain('Expected one of: x, y');
    });
  });

  describe('undefined/null audience handling', () => {
    it('should return valid when audience is undefined and allowNoAudience is true', () => {
      const result = validateAudience(undefined, {
        expectedAudiences: ['aud'],
        allowNoAudience: true,
      });
      expect(result.valid).toBe(true);
    });

    it('should return invalid when audience is undefined and allowNoAudience is false', () => {
      const result = validateAudience(undefined, {
        expectedAudiences: ['aud'],
        allowNoAudience: false,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token is missing audience claim');
    });

    it('should default allowNoAudience to false', () => {
      const result = validateAudience(undefined, {
        expectedAudiences: ['aud'],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token is missing audience claim');
    });

    it('should treat null as undefined for audience', () => {
      const result = validateAudience(null as unknown as undefined, {
        expectedAudiences: ['aud'],
        allowNoAudience: true,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('empty expected audiences', () => {
    it('should return error when expectedAudiences is empty', () => {
      const result = validateAudience('some-aud', {
        expectedAudiences: [],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('No expected audiences configured - cannot validate token');
    });
  });

  describe('case-insensitive matching', () => {
    it('should match case-insensitively when caseSensitive is false', () => {
      const result = validateAudience('HTTPS://API.EXAMPLE.COM', {
        expectedAudiences: ['https://api.example.com'],
        caseSensitive: false,
      });
      expect(result.valid).toBe(true);
      expect(result.matchedAudience).toBe('HTTPS://API.EXAMPLE.COM');
    });

    it('should not match different case when caseSensitive is true (default)', () => {
      const result = validateAudience('HTTPS://API.EXAMPLE.COM', {
        expectedAudiences: ['https://api.example.com'],
      });
      expect(result.valid).toBe(false);
    });

    it('should default caseSensitive to true', () => {
      const result = validateAudience('Aud', {
        expectedAudiences: ['aud'],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('wildcard matching', () => {
    it('should match *.example.com against api.example.com', () => {
      const result = validateAudience('api.example.com', {
        expectedAudiences: ['*.example.com'],
        allowWildcards: true,
      });
      expect(result.valid).toBe(true);
      expect(result.matchedAudience).toBe('api.example.com');
    });

    it('should match api.*.com against api.foo.com', () => {
      const result = validateAudience('api.foo.com', {
        expectedAudiences: ['api.*.com'],
        allowWildcards: true,
      });
      expect(result.valid).toBe(true);
      expect(result.matchedAudience).toBe('api.foo.com');
    });

    it('should not match *.example.com against sub.api.example.com (wildcard does not cross dots)', () => {
      const result = validateAudience('sub.api.example.com', {
        expectedAudiences: ['*.example.com'],
        allowWildcards: true,
      });
      expect(result.valid).toBe(false);
    });

    it('should reject patterns with more than 2 wildcards', () => {
      const result = validateAudience('a.b.c.example.com', {
        expectedAudiences: ['*.*.*.example.com'],
        allowWildcards: true,
      });
      expect(result.valid).toBe(false);
    });

    it('should allow up to 2 wildcards', () => {
      const result = validateAudience('a.b.example.com', {
        expectedAudiences: ['*.*.example.com'],
        allowWildcards: true,
      });
      expect(result.valid).toBe(true);
    });

    it('should not use wildcards when allowWildcards is false (default)', () => {
      const result = validateAudience('api.example.com', {
        expectedAudiences: ['*.example.com'],
        allowWildcards: false,
      });
      expect(result.valid).toBe(false);
    });

    it('should combine case-insensitive and wildcard matching', () => {
      const result = validateAudience('API.EXAMPLE.COM', {
        expectedAudiences: ['*.example.com'],
        allowWildcards: true,
        caseSensitive: false,
      });
      expect(result.valid).toBe(true);
    });
  });
});

describe('createAudienceValidator', () => {
  it('should return a function that validates audience correctly', () => {
    const validator = createAudienceValidator({
      expectedAudiences: ['https://api.example.com'],
    });

    expect(typeof validator).toBe('function');

    const validResult = validator('https://api.example.com');
    expect(validResult.valid).toBe(true);

    const invalidResult = validator('https://wrong.com');
    expect(invalidResult.valid).toBe(false);
  });

  it('should pass through all options to validateAudience', () => {
    const validator = createAudienceValidator({
      expectedAudiences: ['*.example.com'],
      allowWildcards: true,
      caseSensitive: false,
      allowNoAudience: true,
    });

    expect(validator('API.EXAMPLE.COM').valid).toBe(true);
    expect(validator(undefined).valid).toBe(true);
  });
});

describe('deriveExpectedAudience', () => {
  it('should derive audiences from URL with path', () => {
    const audiences = deriveExpectedAudience('https://api.example.com/v1/mcp');
    expect(audiences).toEqual(['https://api.example.com/v1/mcp', 'https://api.example.com', 'api.example.com']);
  });

  it('should derive audiences from URL without path (just origin)', () => {
    const audiences = deriveExpectedAudience('https://api.example.com');
    // pathname is '/' so no origin-only entry
    expect(audiences).toEqual(['https://api.example.com', 'api.example.com']);
  });

  it('should derive audiences from URL with trailing slash', () => {
    const audiences = deriveExpectedAudience('https://api.example.com/');
    // Trailing slash is stripped, pathname is '/' so origin is not duplicated
    expect(audiences).toContain('https://api.example.com');
    expect(audiences).toContain('api.example.com');
  });

  it('should handle URL with port', () => {
    const audiences = deriveExpectedAudience('https://api.example.com:8443/mcp');
    expect(audiences).toContain('https://api.example.com:8443/mcp');
    expect(audiences).toContain('https://api.example.com:8443');
    expect(audiences).toContain('api.example.com:8443');
  });

  it('should return string as-is for non-URL input', () => {
    const audiences = deriveExpectedAudience('my-custom-audience');
    expect(audiences).toEqual(['my-custom-audience']);
  });

  it('should return string as-is for invalid URL', () => {
    const audiences = deriveExpectedAudience('not://valid url with spaces');
    expect(audiences).toEqual(['not://valid url with spaces']);
  });
});

describe('AudienceValidator class', () => {
  describe('constructor', () => {
    it('should create validator with options', () => {
      const validator = new AudienceValidator({
        expectedAudiences: ['https://api.example.com'],
        allowNoAudience: true,
        caseSensitive: false,
        allowWildcards: true,
      });
      expect(validator).toBeInstanceOf(AudienceValidator);
    });

    it('should create validator with default options', () => {
      const validator = new AudienceValidator();
      // Default: no expected audiences, no allowNoAudience, case sensitive, no wildcards
      const result = validator.validate('some-aud');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('No expected audiences configured');
    });

    it('should copy expectedAudiences array (not reference)', () => {
      const audiences = ['aud1'];
      const validator = new AudienceValidator({ expectedAudiences: audiences });
      audiences.push('aud2');
      // Mutating original should not affect validator
      const result = validator.validate('aud2');
      expect(result.valid).toBe(false);
    });
  });

  describe('validate()', () => {
    it('should validate audience correctly', () => {
      const validator = new AudienceValidator({
        expectedAudiences: ['https://api.example.com'],
      });
      const result = validator.validate('https://api.example.com');
      expect(result.valid).toBe(true);
      expect(result.matchedAudience).toBe('https://api.example.com');
    });

    it('should reject non-matching audience', () => {
      const validator = new AudienceValidator({
        expectedAudiences: ['https://api.example.com'],
      });
      const result = validator.validate('https://wrong.com');
      expect(result.valid).toBe(false);
    });
  });

  describe('addAudiences()', () => {
    it('should add new audiences to the expected list', () => {
      const validator = new AudienceValidator({
        expectedAudiences: ['aud1'],
      });

      // aud2 should fail initially
      expect(validator.validate('aud2').valid).toBe(false);

      validator.addAudiences('aud2', 'aud3');

      expect(validator.validate('aud2').valid).toBe(true);
      expect(validator.validate('aud3').valid).toBe(true);
      // Original should still work
      expect(validator.validate('aud1').valid).toBe(true);
    });
  });

  describe('setAudiences()', () => {
    it('should replace existing expected audiences', () => {
      const validator = new AudienceValidator({
        expectedAudiences: ['aud1', 'aud2'],
      });

      expect(validator.validate('aud1').valid).toBe(true);

      validator.setAudiences(['aud3']);

      expect(validator.validate('aud1').valid).toBe(false);
      expect(validator.validate('aud3').valid).toBe(true);
    });
  });

  describe('fromResourceUrl()', () => {
    it('should create validator from resource URL', () => {
      const validator = AudienceValidator.fromResourceUrl('https://api.example.com/v1/mcp');
      expect(validator).toBeInstanceOf(AudienceValidator);

      expect(validator.validate('https://api.example.com/v1/mcp').valid).toBe(true);
      expect(validator.validate('https://api.example.com').valid).toBe(true);
      expect(validator.validate('api.example.com').valid).toBe(true);
      expect(validator.validate('https://wrong.com').valid).toBe(false);
    });

    it('should pass additional options to the validator', () => {
      const validator = AudienceValidator.fromResourceUrl('https://api.example.com/v1/mcp', {
        allowNoAudience: true,
        caseSensitive: false,
      });

      expect(validator.validate(undefined).valid).toBe(true);
      expect(validator.validate('HTTPS://API.EXAMPLE.COM/V1/MCP').valid).toBe(true);
    });
  });
});
