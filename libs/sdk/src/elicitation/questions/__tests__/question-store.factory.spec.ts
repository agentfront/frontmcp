import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import * as utils from '@frontmcp/utils';
import { mkdtemp, rm, stat } from '@frontmcp/utils';

import { elicitationOptionsSchema } from '../../../common/types/options/elicitation';
import { InvalidQuestionStoreError } from '../../../errors';
import {
  DEFAULT_QUESTION_TTL_MS,
  openPersistentQuestions,
  parsePersistentQuestionsOptions,
} from '../question-scope.helper';
import { createQuestionStore, resolveQuestionStorage } from '../question-store.factory';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual<typeof import('@frontmcp/utils')>('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const logger = { info: jest.fn(), warn: jest.fn() } as never;

describe('resolveQuestionStorage', () => {
  const previousHome = process.env['FRONTMCP_HOME'];
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-home-'));
    process.env['FRONTMCP_HOME'] = path.join(home, 'nested');
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  it('takes the store the options name first', async () => {
    expect(
      await resolveQuestionStorage({
        storage: { type: 'memory' },
        redis: { host: 'redis.local' },
        sqlite: { path: '/x.sqlite' },
      }),
    ).toEqual({ type: 'memory' });
  });

  it("takes the server's redis next", async () => {
    expect(
      await resolveQuestionStorage({ redis: { host: 'redis.local', port: 6380 }, sqlite: { path: '/x' } }),
    ).toEqual({ type: 'redis', redis: { config: expect.objectContaining({ host: 'redis.local', port: 6380 }) } });
  });

  it("takes the server's sqlite file next", async () => {
    expect(await resolveQuestionStorage({ sqlite: { path: '/srv/state.sqlite' } })).toEqual({
      type: 'sqlite',
      sqlite: { path: '/srv/state.sqlite' },
    });
  });

  it('falls back to an owner-only questions.sqlite in FRONTMCP_HOME', async () => {
    const storage = await resolveQuestionStorage({});
    const file = path.join(home, 'nested', 'questions.sqlite');

    expect(storage).toEqual({ type: 'sqlite', sqlite: { path: file } });
    if (process.platform !== 'win32') {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect((await stat(path.join(home, 'nested'))).mode & 0o777).toBe(0o700);
    }
  });

  it.each([
    ['an edge runtime', { runtime: 'edge', deployment: 'standalone' }],
    ['a serverless deployment', { runtime: 'node', deployment: 'serverless' }],
  ])('has no default store on %s', async (_case, context) => {
    jest.mocked(utils.getRuntimeContext).mockReturnValueOnce(context as never);

    await expect(resolveQuestionStorage({})).rejects.toThrow(InvalidQuestionStoreError);
  });
});

describe('createQuestionStore', () => {
  const previousSecret = process.env['MCP_ELICITATION_SECRET'];

  afterEach(() => {
    if (previousSecret === undefined) delete process.env['MCP_ELICITATION_SECRET'];
    else process.env['MCP_ELICITATION_SECRET'] = previousSecret;
  });

  it('encrypts when the elicitation secret is set', async () => {
    process.env['MCP_ELICITATION_SECRET'] = 'a-secret-from-the-environment';
    const { store, encrypted } = await createQuestionStore({ storage: { type: 'memory' } });

    expect([encrypted, store.encrypted]).toEqual([true, true]);
    await store.close();
  });

  it('refuses encryption it cannot do', async () => {
    delete process.env['MCP_ELICITATION_SECRET'];
    delete process.env['MCP_SESSION_SECRET'];
    delete process.env['MCP_SERVER_SECRET'];

    await expect(createQuestionStore({ storage: { type: 'memory' }, encryption: { enabled: true } })).rejects.toThrow(
      InvalidQuestionStoreError,
    );
  });

  it('fails, rather than falling back, on a store it cannot open', async () => {
    await expect(createQuestionStore({ storage: { type: 'sqlite', sqlite: {} } as never })).rejects.toThrow(
      /elicitation\.persistent: the sqlite store cannot be opened/,
    );
  });
});

describe('openPersistentQuestions', () => {
  it('opens nothing while persistent questions are off', async () => {
    expect(await openPersistentQuestions({ persistent: undefined, logger })).toBeUndefined();
    expect(await openPersistentQuestions({ persistent: false, logger })).toBeUndefined();
  });

  it('opens the store with the TTL the options give, or a day', async () => {
    const custom = await openPersistentQuestions({
      persistent: { ttlMs: 3_600_000, storage: { type: 'memory' } },
      logger,
    });
    const fallback = await openPersistentQuestions({ persistent: { storage: { type: 'memory' } }, logger });

    expect([custom?.ttlMs, custom?.type, fallback?.ttlMs]).toEqual([3_600_000, 'memory', DEFAULT_QUESTION_TTL_MS]);
    await Promise.all([custom?.store.close(), fallback?.store.close()]);
  });
});

describe('elicitation.persistent options', () => {
  it.each([[true], [false], [{ ttlMs: 1000 }], [{ storage: { type: 'sqlite', sqlite: { path: '/q.sqlite' } } }]])(
    'lets the server metadata hold %j, checked when the server opens the store',
    (persistent) => {
      expect(elicitationOptionsSchema.safeParse({ enabled: true, persistent }).success).toBe(true);
    },
  );

  it.each([
    [true, {}],
    [{ ttlMs: 1000 }, { ttlMs: 1000 }],
  ])('reads %j as the settings %j', (persistent, settings) => {
    expect(parsePersistentQuestionsOptions(persistent)).toEqual(settings);
  });

  it.each([
    [{ ttlMs: 0 }, 'elicitation.persistent: ttlMs must be greater than 0'],
    [{ ttlMs: 1.5 }, 'elicitation.persistent: ttlMs must be a whole number of milliseconds'],
    [{ storage: { type: 'upstash' } }, "elicitation.persistent: storage.type must be 'memory', 'redis' or 'sqlite'"],
    [{ ttl: 5 }, 'elicitation.persistent: Unrecognized key: "ttl"'],
    ['yes', 'elicitation.persistent: it must be true, false or an object of settings'],
  ])('fails the boot on %j', async (persistent, message) => {
    const opening = openPersistentQuestions({ persistent, logger });

    await expect(opening).rejects.toThrow(InvalidQuestionStoreError);
    await expect(opening).rejects.toThrow(message);
  });
});
