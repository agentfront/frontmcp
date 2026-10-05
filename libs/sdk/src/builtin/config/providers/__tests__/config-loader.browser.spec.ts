/**
 * ConfigPlugin in the browser build (#761): `@frontmcp/utils` resolves `pathResolve()` to a stub that
 * throws and reports the runtime as `browser`, so the file sources are absent and the config comes
 * from the schema defaults and `process.env`.
 */
import { z } from '@frontmcp/lazy-zod';

import { loadConfig } from '../config-loader';
import { loadEnvFiles } from '../env-loader';

const readFile = jest.fn();

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  getRuntimeContext: () => ({ runtime: 'browser', platform: 'browser', os: 'browser' }),
  pathResolve: () => {
    throw new Error('path.resolve() is not available in browser environments');
  },
  readFile: (...args: unknown[]) => readFile(...args),
}));

const schema = z.object({ pageSize: z.coerce.number().default(20), theme: z.string().default('light') });

describe('loadConfig in the browser build', () => {
  afterEach(() => {
    delete process.env['PAGESIZE'];
    readFile.mockClear();
  });

  it('starts from the schema defaults without reading .env files', async () => {
    await expect(loadConfig(schema)).resolves.toEqual({ pageSize: 20, theme: 'light' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('skips the YAML file too', async () => {
    await expect(loadConfig(schema, { loadYaml: true })).resolves.toEqual({ pageSize: 20, theme: 'light' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('still reads process.env where there is one', async () => {
    process.env['PAGESIZE'] = '50';

    await expect(loadConfig(schema)).resolves.toEqual({ pageSize: 50, theme: 'light' });
  });
});

describe('loadEnvFiles in the browser build', () => {
  it('finds no .env files', async () => {
    await expect(loadEnvFiles()).resolves.toEqual({});
  });
});
