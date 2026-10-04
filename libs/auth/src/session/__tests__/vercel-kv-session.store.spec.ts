import type { StoredSession } from '../transport-session.types';
import { VercelKvSessionStore } from '../vercel-kv-session.store';

const mockStoredValues = new Map<string, string>();

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  VercelKvStorageAdapter: jest.fn().mockImplementation(() => ({
    connect: jest.fn(async () => undefined),
    get: jest.fn(async (key: string) => mockStoredValues.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      mockStoredValues.set(key, value);
    }),
    delete: jest.fn(async (key: string) => mockStoredValues.delete(key)),
    expire: jest.fn(async () => true),
  })),
}));

function createStoredSession(): StoredSession {
  const now = Date.now();
  return {
    session: {
      id: 'session-1',
      authorizationId: 'auth-1',
      protocol: 'streamable-http',
      createdAt: now,
      expiresAt: now + 3600000,
      nodeId: 'node-1',
    },
    authorizationId: 'auth-1',
    createdAt: now,
    lastAccessedAt: now,
  };
}

describe('VercelKvSessionStore', () => {
  const connection = { url: 'https://kv.example.com', token: 'token' };

  beforeEach(() => {
    mockStoredValues.clear();
  });

  it('reads back a session stored as a JSON string', async () => {
    const store = new VercelKvSessionStore(connection);
    const storedSession = createStoredSession();

    await store.set('session-1', storedSession);

    await expect(store.get('session-1')).resolves.toMatchObject({
      ...storedSession,
      lastAccessedAt: expect.any(Number),
    });
  });

  it('reads back a signed session', async () => {
    const store = new VercelKvSessionStore({
      ...connection,
      security: { enableSigning: true, signingSecret: 'test-signing-secret-with-enough-length' },
    });
    const storedSession = createStoredSession();

    await store.set('session-1', storedSession);

    await expect(store.get('session-1')).resolves.toMatchObject({ authorizationId: 'auth-1' });
  });
});
