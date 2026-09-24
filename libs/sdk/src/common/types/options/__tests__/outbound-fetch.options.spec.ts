import { outboundFetchOptionsSchema } from '../outbound-fetch';

describe('outboundFetchOptionsSchema', () => {
  it('forwards nothing by default', () => {
    expect(outboundFetchOptionsSchema.parse({})).toEqual({
      forwardCallerTokenTo: [],
      forwardCustomHeadersTo: [],
      autoInjectTracingHeaders: true,
      requestTimeout: 30000,
    });
  });

  it('normalizes allow-listed URLs to their origins', () => {
    const options = outboundFetchOptionsSchema.parse({
      forwardCallerTokenTo: ['https://API.example.com/v1/users', 'https://api.example.com:443'],
      forwardCustomHeadersTo: ['http://internal.example:8080/path'],
    });

    expect(options.forwardCallerTokenTo).toEqual(['https://api.example.com', 'https://api.example.com']);
    expect(options.forwardCustomHeadersTo).toEqual(['http://internal.example:8080']);
  });

  it('rejects an entry that is not an http(s) URL', () => {
    expect(() => outboundFetchOptionsSchema.parse({ forwardCallerTokenTo: ['api.example.com'] })).toThrow();
    expect(() => outboundFetchOptionsSchema.parse({ forwardCustomHeadersTo: ['ftp://files.example.com'] })).toThrow();
  });
});
