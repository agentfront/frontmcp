import { createMemoryStorage } from '@frontmcp/utils';

import { ElicitationNotSupportedError } from '../../../errors/elicitation.error';
import { createElicitationStoreFromStorage, createMemoryElicitationStore } from '../elicitation-store.factory';

const SECRET_VARIABLES = ['MCP_ELICITATION_SECRET', 'MCP_SESSION_SECRET', 'MCP_SERVER_SECRET'];

describe('elicitation store factories with encryption enabled', () => {
  const saved = SECRET_VARIABLES.map((variable) => process.env[variable]);

  beforeEach(() => {
    for (const variable of SECRET_VARIABLES) delete process.env[variable];
  });

  afterEach(() => {
    SECRET_VARIABLES.forEach((variable, index) => {
      if (saved[index] === undefined) delete process.env[variable];
      else process.env[variable] = saved[index];
    });
  });

  it('createMemoryElicitationStore refuses to return a plaintext store when no secret is available', () => {
    expect(() => createMemoryElicitationStore({ encryption: { enabled: true } })).toThrow(ElicitationNotSupportedError);
  });

  it('createElicitationStoreFromStorage refuses to return a plaintext store when no secret is available', () => {
    expect(() => createElicitationStoreFromStorage(createMemoryStorage(), { encryption: { enabled: true } })).toThrow(
      ElicitationNotSupportedError,
    );
  });

  it('both encrypt when a secret is given', () => {
    const encryption = { enabled: true, secret: 'a-secret-of-enough-length-for-tests' };
    expect(createMemoryElicitationStore({ encryption }).encrypted).toBe(true);
    expect(createElicitationStoreFromStorage(createMemoryStorage(), { encryption }).encrypted).toBe(true);
  });

  it('auto mode without a secret still returns an unencrypted store, as before', () => {
    expect(createMemoryElicitationStore({ encryption: { enabled: 'auto' } }).encrypted).toBe(false);
  });
});
