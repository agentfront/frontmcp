/**
 * The Upstash and Vercel KV adapters over the real `@upstash/redis` client, with only `fetch` faked:
 * values come back exactly as stored, never JSON-parsed by the client (#716).
 */
import { TypedStorage } from '../../typed-storage';
import type { StorageAdapter } from '../../types';
import { COMPARE_AND_DELETE_SCRIPT } from '../../utils/compare-and-delete';
import { UpstashStorageAdapter } from '../upstash';
import { VercelKvStorageAdapter } from '../vercel-kv';

type RestReply = string | number | null | RestReply[];

const JSON_OBJECT = '{"a":1}';
const JSON_STRING = '"x"';
const JSON_NUMBER = '5';

function encodeReply(reply: RestReply): RestReply {
  if (typeof reply === 'string') return reply === 'OK' ? reply : btoa(reply);
  if (Array.isArray(reply)) return reply.map(encodeReply);
  return reply;
}

/** An in-memory Redis behind the Upstash REST protocol, replying in base64 as Upstash does. */
function createFakeRedisRest() {
  const values = new Map<string, string>();
  const lists = new Map<string, string[]>();

  const execute = (command: unknown[]): RestReply => {
    const [commandName, ...args] = command.map(String);
    const [key] = args;
    switch (commandName.toLowerCase()) {
      case 'set':
        values.set(key, args[1]);
        return 'OK';
      case 'get':
        return values.get(key) ?? null;
      case 'mget':
        return args.map((mgetKey) => values.get(mgetKey) ?? null);
      case 'exists':
        return args.filter((existsKey) => values.has(existsKey)).length;
      case 'incr': {
        const counter = Number(values.get(key) ?? '0') + 1;
        values.set(key, String(counter));
        return counter;
      }
      case 'ttl':
        return values.has(key) ? -1 : -2;
      case 'scan':
        return ['0', [...values.keys()]];
      case 'eval': {
        const [script, , evalKey, expectedValue] = args;
        if (script !== COMPARE_AND_DELETE_SCRIPT || values.get(evalKey) !== expectedValue) return 0;
        values.delete(evalKey);
        return 1;
      }
      case 'lpush': {
        const list = lists.get(key) ?? [];
        list.unshift(...args.slice(1));
        lists.set(key, list);
        return list.length;
      }
      case 'rpop':
        return lists.get(key)?.pop() ?? null;
      default:
        throw new Error(`The fake REST API does not support ${commandName}`);
    }
  };

  const handleFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body: unknown = JSON.parse(String(init?.body));
    const replies = String(url).endsWith('/pipeline')
      ? (body as unknown[][]).map((command) => ({ result: encodeReply(execute(command)) }))
      : { result: encodeReply(execute(body as unknown[])) };
    return new Response(JSON.stringify(replies), { status: 200 });
  };

  return { values, handleFetch };
}

const restOptions = { url: 'https://fake-redis.example.com', token: 'token' };

describe.each<[string, () => StorageAdapter]>([
  ['UpstashStorageAdapter', () => new UpstashStorageAdapter(restOptions)],
  ['VercelKvStorageAdapter', () => new VercelKvStorageAdapter(restOptions)],
])('%s over the REST API', (_adapterName, createAdapter) => {
  let adapter: StorageAdapter;

  beforeEach(async () => {
    const fakeRest = createFakeRedisRest();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fakeRest.handleFetch);
    adapter = createAdapter();
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
    jest.restoreAllMocks();
  });

  it('returns JSON-looking values from get() as the stored strings', async () => {
    await adapter.set('object', JSON_OBJECT);
    await adapter.set('string', JSON_STRING);
    await adapter.set('number', JSON_NUMBER);

    await expect(adapter.get('object')).resolves.toBe(JSON_OBJECT);
    await expect(adapter.get('string')).resolves.toBe(JSON_STRING);
    await expect(adapter.get('number')).resolves.toBe(JSON_NUMBER);
  });

  it('returns JSON-looking values from mget() as the stored strings', async () => {
    await adapter.set('object', JSON_OBJECT);
    await adapter.set('string', JSON_STRING);
    await adapter.set('number', JSON_NUMBER);

    await expect(adapter.mget(['object', 'string', 'number', 'missing'])).resolves.toEqual([
      JSON_OBJECT,
      JSON_STRING,
      JSON_NUMBER,
      null,
    ]);
  });

  it('returns a counter as a number from incr() and as a string from get()', async () => {
    await expect(adapter.incr('counter')).resolves.toBe(1);
    await expect(adapter.incr('counter')).resolves.toBe(2);
    await expect(adapter.get('counter')).resolves.toBe('2');
  });

  it('returns JSON-looking key names from keys() as strings', async () => {
    await adapter.set(JSON_OBJECT, 'value');
    await adapter.set(JSON_NUMBER, 'value');

    await expect(adapter.keys('*')).resolves.toEqual([JSON_OBJECT, JSON_NUMBER]);
  });

  it('reports ttl() and deleteIfEquals() results as numbers and booleans', async () => {
    await adapter.set('object', JSON_OBJECT);

    await expect(adapter.ttl('object')).resolves.toBe(-1);
    await expect(adapter.deleteIfEquals('object', JSON_OBJECT)).resolves.toBe(true);
    await expect(adapter.ttl('object')).resolves.toBeNull();
  });

  it('round-trips a TypedStorage record', async () => {
    const records = new TypedStorage<{ id: string; tags: string[] }>(adapter);
    const record = { id: 'record-1', tags: ['a', 'b'] };

    await records.set('record', record);

    await expect(records.get('record')).resolves.toEqual(record);
    await expect(records.mget(['record'])).resolves.toEqual([record]);
  });
});

describe('UpstashStorageAdapter pub/sub over the REST API', () => {
  let adapter: UpstashStorageAdapter;

  beforeEach(async () => {
    const fakeRest = createFakeRedisRest();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fakeRest.handleFetch);
    adapter = new UpstashStorageAdapter({ ...restOptions, enablePubSub: true });
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
    jest.restoreAllMocks();
  });

  it('delivers a JSON-looking message as the published string', async () => {
    const received = new Promise<string>((resolve) => {
      void adapter.subscribe('events', (message) => resolve(message));
    });
    await adapter.publish('events', JSON_OBJECT);

    await expect(received).resolves.toBe(JSON_OBJECT);
  });
});
