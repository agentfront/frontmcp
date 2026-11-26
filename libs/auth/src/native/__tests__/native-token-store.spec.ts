import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mkdtemp, readFile, rm, stat, writeFile } from '@frontmcp/utils';

import { fileTokenStore, memoryTokenStore, type NativeTokenSet } from '../native-token-store';

const tokens = (accessToken: string): NativeTokenSet => ({
  accessToken,
  tokenType: 'Bearer',
  refreshToken: `${accessToken}-refresh`,
  expiresAt: 1_900_000_000_000,
  issuer: 'https://auth.example.com',
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'notes-cli',
});

describe('memoryTokenStore', () => {
  it('keeps, replaces and forgets tokens per key', async () => {
    const store = memoryTokenStore();
    await store.set('a', tokens('one'));
    await store.set('a', tokens('two'));
    expect(await store.get('a')).toEqual(tokens('two'));
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
  });
});

describe('fileTokenStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'native-tokens-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is empty before the file exists', async () => {
    expect(await fileTokenStore(join(dir, 'tokens.json')).get('a')).toBeUndefined();
  });

  it('writes a file only the user can read, in a directory it creates', async () => {
    const filePath = join(dir, 'nested', 'tokens.json');
    await fileTokenStore(filePath).set('a', tokens('one'));

    expect(JSON.parse(await readFile(filePath))).toEqual({ a: tokens('one') });
    if (process.platform !== 'win32') {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
      expect((await stat(join(dir, 'nested'))).mode & 0o777).toBe(0o700);
    }
  });

  it('keeps every key through concurrent writes, and another store on the same file reads them', async () => {
    const filePath = join(dir, 'tokens.json');
    const store = fileTokenStore(filePath);
    await Promise.all([store.set('a', tokens('one')), store.set('b', tokens('two')), store.set('c', tokens('three'))]);
    await store.delete('b');

    const other = fileTokenStore(filePath);
    expect(await other.get('a')).toEqual(tokens('one'));
    expect(await other.get('b')).toBeUndefined();
    expect(await other.get('c')).toEqual(tokens('three'));
  });

  it('reports a file that is not JSON', async () => {
    const filePath = join(dir, 'tokens.json');
    await writeFile(filePath, 'not json');
    await expect(fileTokenStore(filePath).get('a')).rejects.toThrow(SyntaxError);
  });
});
