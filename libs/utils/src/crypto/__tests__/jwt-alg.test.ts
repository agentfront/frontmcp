/**
 * JWT Algorithm Tests
 *
 * Tests for JWT algorithm mapping utilities.
 */

import { jwtAlgToNodeAlg, isRsaPssAlg } from '../jwt-alg';

describe('JWT Algorithm Utilities', () => {
  describe('jwtAlgToNodeAlg()', () => {
    describe('RSA algorithms', () => {
      it('should map RS256 to RSA-SHA256', () => {
        expect(jwtAlgToNodeAlg('RS256')).toBe('RSA-SHA256');
      });

      it('should map RS384 to RSA-SHA384', () => {
        expect(jwtAlgToNodeAlg('RS384')).toBe('RSA-SHA384');
      });

      it('should map RS512 to RSA-SHA512', () => {
        expect(jwtAlgToNodeAlg('RS512')).toBe('RSA-SHA512');
      });
    });

    describe('RSA-PSS algorithms', () => {
      it('should map PS256 to RSA-SHA256', () => {
        expect(jwtAlgToNodeAlg('PS256')).toBe('RSA-SHA256');
      });

      it('should map PS384 to RSA-SHA384', () => {
        expect(jwtAlgToNodeAlg('PS384')).toBe('RSA-SHA384');
      });

      it('should map PS512 to RSA-SHA512', () => {
        expect(jwtAlgToNodeAlg('PS512')).toBe('RSA-SHA512');
      });
    });

    describe('unsupported algorithms', () => {
      it('should throw for HS256', () => {
        expect(() => jwtAlgToNodeAlg('HS256')).toThrow('Unsupported JWT algorithm: HS256');
      });

      it('should throw for HS384', () => {
        expect(() => jwtAlgToNodeAlg('HS384')).toThrow('Unsupported JWT algorithm: HS384');
      });

      it('should throw for HS512', () => {
        expect(() => jwtAlgToNodeAlg('HS512')).toThrow('Unsupported JWT algorithm: HS512');
      });

      it('should throw for ES256', () => {
        expect(() => jwtAlgToNodeAlg('ES256')).toThrow('Unsupported JWT algorithm: ES256');
      });

      it('should throw for ES384', () => {
        expect(() => jwtAlgToNodeAlg('ES384')).toThrow('Unsupported JWT algorithm: ES384');
      });

      it('should throw for ES512', () => {
        expect(() => jwtAlgToNodeAlg('ES512')).toThrow('Unsupported JWT algorithm: ES512');
      });

      it('should throw for none', () => {
        expect(() => jwtAlgToNodeAlg('none')).toThrow('Unsupported JWT algorithm: none');
      });

      it('should throw for empty string', () => {
        expect(() => jwtAlgToNodeAlg('')).toThrow('Unsupported JWT algorithm: ');
      });

      it('should throw for arbitrary string', () => {
        expect(() => jwtAlgToNodeAlg('INVALID')).toThrow('Unsupported JWT algorithm: INVALID');
      });

      it('should throw for lowercase algorithm names', () => {
        expect(() => jwtAlgToNodeAlg('rs256')).toThrow('Unsupported JWT algorithm: rs256');
      });

      it('should throw for mixed case algorithm names', () => {
        expect(() => jwtAlgToNodeAlg('Rs256')).toThrow('Unsupported JWT algorithm: Rs256');
      });
    });
  });

  describe('isRsaPssAlg()', () => {
    describe('PSS algorithms (true)', () => {
      it('should return true for PS256', () => {
        expect(isRsaPssAlg('PS256')).toBe(true);
      });

      it('should return true for PS384', () => {
        expect(isRsaPssAlg('PS384')).toBe(true);
      });

      it('should return true for PS512', () => {
        expect(isRsaPssAlg('PS512')).toBe(true);
      });

      it('should return true for any string starting with PS', () => {
        expect(isRsaPssAlg('PS')).toBe(true);
        expect(isRsaPssAlg('PS1')).toBe(true);
        expect(isRsaPssAlg('PS999')).toBe(true);
        expect(isRsaPssAlg('PSXYZ')).toBe(true);
      });
    });

    describe('Non-PSS algorithms (false)', () => {
      it('should return false for RS256', () => {
        expect(isRsaPssAlg('RS256')).toBe(false);
      });

      it('should return false for RS384', () => {
        expect(isRsaPssAlg('RS384')).toBe(false);
      });

      it('should return false for RS512', () => {
        expect(isRsaPssAlg('RS512')).toBe(false);
      });

      it('should return false for HS256', () => {
        expect(isRsaPssAlg('HS256')).toBe(false);
      });

      it('should return false for ES256', () => {
        expect(isRsaPssAlg('ES256')).toBe(false);
      });

      it('should return false for none', () => {
        expect(isRsaPssAlg('none')).toBe(false);
      });

      it('should return false for empty string', () => {
        expect(isRsaPssAlg('')).toBe(false);
      });

      it('should return false for lowercase ps256', () => {
        expect(isRsaPssAlg('ps256')).toBe(false);
      });

      it('should return false for P alone', () => {
        expect(isRsaPssAlg('P')).toBe(false);
      });
    });
  });
});
