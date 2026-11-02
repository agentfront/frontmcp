/**
 * `http.forwardHeaders` keeps more request headers than `x-frontmcp-*` in the context's
 * `customHeaders`, over HTTP and for in-process calls, and never a refused one.
 */
import { createHeaderForwarder } from '../../common/utils/forward-headers.utils';
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
