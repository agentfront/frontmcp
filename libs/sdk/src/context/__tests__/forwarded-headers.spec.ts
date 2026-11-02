/**
 * `http.forwardHeaders` keeps more request headers than `x-frontmcp-*` in the context's
 * `customHeaders`, over HTTP and for in-process calls, and never a refused one.
 */
import { createHeaderForwarder } from '../../common/utils/forward-headers.utils';
import type { FrontMcpContext } from '../frontmcp-context';
import { FrontMcpContextStorage } from '../frontmcp-context-storage';
import { extractMetadata, inProcessRequestContext } from '../metadata.utils';

const headers = {
  'x-frontmcp-trace': 'kept',
  'x-acme-tenant': 'blue',
  'X-Acme-Region': 'eu',
  'x-other': 'dropped',
  authorization: 'Bearer secret',
  'proxy-authorization': 'Basic secret',
};

describe('forwarded headers', () => {
  it('keeps only x-frontmcp-* headers without forwardHeaders', () => {
    expect(extractMetadata(headers).customHeaders).toEqual({ 'x-frontmcp-trace': 'kept' });
  });

  it('keeps the headers forwardHeaders names, lower-cased', () => {
    const metadata = extractMetadata(headers, { forwardsHeader: createHeaderForwarder(['x-acme-*']) });
    expect(metadata.customHeaders).toEqual({
      'x-frontmcp-trace': 'kept',
      'x-acme-tenant': 'blue',
      'x-acme-region': 'eu',
    });
  });

  it('never keeps a refused header', () => {
    const metadata = extractMetadata(headers, { forwardsHeader: createHeaderForwarder(['*-authorization']) });
    expect(metadata.customHeaders).toEqual({ 'x-frontmcp-trace': 'kept' });
  });

  it('applies forwardHeaders to in-process calls too', () => {
    const { metadata } = inProcessRequestContext(
      { customHeaders: { 'x-acme-tenant': 'blue', 'x-other': 'dropped' } },
      { forwardsHeader: createHeaderForwarder(['x-acme-*']) },
    );
    expect(metadata.customHeaders).toEqual({ 'x-acme-tenant': 'blue' });
  });

  it('reaches the context the storage builds from request headers', () => {
    const storage = new FrontMcpContextStorage().configure({}, { forwardsHeader: createHeaderForwarder(['x-acme-*']) });
    const customHeaders = storage.runFromHeaders(
      headers,
      { sessionId: 's', scopeId: 'root' },
      () => storage.getStore()?.metadata.customHeaders,
    );
    expect(customHeaders).toEqual({ 'x-frontmcp-trace': 'kept', 'x-acme-tenant': 'blue', 'x-acme-region': 'eu' });
    expect(storage.forwardsHeader?.('x-acme-tenant')).toBe(true);
  });
});

describe('forwarded headers sent upstream by this.fetch()', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  function contextWithForwardedHeader(): FrontMcpContext {
    const storage = new FrontMcpContextStorage().configure(
      { forwardCustomHeadersTo: ['https://api.internal.example'] },
      { forwardsHeader: createHeaderForwarder(['x-acme-*']) },
    );
    let context: FrontMcpContext | undefined;
    storage.runFromHeaders(headers, { sessionId: 's', scopeId: 'root' }, () => {
      context = storage.getStore();
    });
    if (!context) throw new Error('expected a request context');
    return context;
  }

  function sentHeader(name: string): string | null {
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    return new Headers(init.headers).get(name);
  }

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(new Response('{}'));
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reach an origin fetch.forwardCustomHeadersTo lists', async () => {
    await contextWithForwardedHeader().fetch('https://api.internal.example/v1/tenant');
    expect(sentHeader('x-acme-tenant')).toBe('blue');
  });

  it('never reach another origin', async () => {
    await contextWithForwardedHeader().fetch('https://third-party.example/v1/forecast');
    expect(sentHeader('x-acme-tenant')).toBeNull();
  });
});
