import * as authTesting from '@frontmcp/auth/testing';

import * as testing from '../../index';

describe('@frontmcp/testing auth exports', () => {
  it('are the classes of @frontmcp/auth/testing, so the old import keeps working', () => {
    expect(testing.MockOAuthServer).toBe(authTesting.MockOAuthServer);
    expect(testing.TestTokenFactory).toBe(authTesting.TestTokenFactory);
  });
});
