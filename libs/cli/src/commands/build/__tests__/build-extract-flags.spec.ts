import { setBuildExtractFlags } from '../build-extract-flags';

describe('setBuildExtractFlags', () => {
  afterEach(() => {
    delete process.env['FRONTMCP_SCHEMA_EXTRACT'];
    delete process.env['FRONTMCP_BUILD_EXTRACT'];
  });

  it('sets both flags, and puts back a value one had', () => {
    process.env['FRONTMCP_SCHEMA_EXTRACT'] = 'kept';

    const restore = setBuildExtractFlags();
    expect([process.env['FRONTMCP_SCHEMA_EXTRACT'], process.env['FRONTMCP_BUILD_EXTRACT']]).toEqual(['1', '1']);

    restore();
    expect(process.env['FRONTMCP_SCHEMA_EXTRACT']).toBe('kept');
    expect(process.env['FRONTMCP_BUILD_EXTRACT']).toBeUndefined();
  });
});
