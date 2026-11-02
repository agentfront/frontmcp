import { httpOptionsSchema } from '../../types/options/http';
import { createHeaderForwarder, isRefusedForwardHeader, refusedHeadersMatchedBy } from '../forward-headers.utils';

describe('forward-headers utils', () => {
  describe('isRefusedForwardHeader', () => {
    it.each(['authorization', 'Cookie', 'proxy-authorization', 'Proxy-Anything', 'connection', 'transfer-encoding'])(
      'refuses %s',
      (name) => {
        expect(isRefusedForwardHeader(name)).toBe(true);
      },
    );

    it('allows an application header', () => {
      expect(isRefusedForwardHeader('x-acme-tenant')).toBe(false);
    });
  });

  describe('refusedHeadersMatchedBy', () => {
    it('names the refused headers a glob matches', () => {
      expect(refusedHeadersMatchedBy('proxy-*')).toEqual(
        expect.arrayContaining(['proxy-authorization', 'proxy-authenticate']),
      );
      expect(refusedHeadersMatchedBy('*')).toContain('authorization');
      expect(refusedHeadersMatchedBy('AUTHORIZATION')).toEqual(['authorization']);
    });

    it('matches nothing for an application glob', () => {
      expect(refusedHeadersMatchedBy('x-acme-*')).toEqual([]);
    });
  });

  describe('createHeaderForwarder', () => {
    it('is undefined without globs', () => {
      expect(createHeaderForwarder(undefined)).toBeUndefined();
      expect(createHeaderForwarder([])).toBeUndefined();
    });

    it('matches names against the globs without regard to case', () => {
      const forwards = createHeaderForwarder(['x-acme-*', 'x-tenant']);
      expect(forwards?.('X-Acme-Region')).toBe(true);
      expect(forwards?.('x-tenant')).toBe(true);
      expect(forwards?.('x-tenant-id')).toBe(false);
    });

    it('never forwards a refused header, whatever the glob', () => {
      const forwards = createHeaderForwarder(['*-tenant']);
      expect(forwards?.('x-acme-tenant')).toBe(true);
      expect(forwards?.('proxy-tenant')).toBe(false);
    });
  });

  describe('http.forwardHeaders validation', () => {
    it('accepts header globs', () => {
      expect(httpOptionsSchema.parse({ forwardHeaders: ['x-acme-*', 'x-request-source'] }).forwardHeaders).toEqual([
        'x-acme-*',
        'x-request-source',
      ]);
    });

    it.each([['authorization'], ['Cookie'], ['proxy-*'], ['*'], ['keep-alive'], ['upgrade']])(
      'refuses %s with a message naming it',
      (glob) => {
        const result = httpOptionsSchema.safeParse({ forwardHeaders: [glob] });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain(`"${glob}"`);
        expect(result.error?.issues[0]?.message).toContain('never forwards');
      },
    );

    it('refuses a name that is not a header token', () => {
      const result = httpOptionsSchema.safeParse({ forwardHeaders: ['x acme'] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('header name');
    });
  });
});
