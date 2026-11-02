import { ResultHandlesConfigurationError } from '../result-handles.errors';
import { DEFAULT_MEMORY_MAX_ENTRIES, MIN_THRESHOLD_BYTES, parseResultHandlesOptions } from '../result-handles.options';
import ResultHandlesPlugin from '../result-handles.plugin';

describe('parseResultHandlesOptions', () => {
  it('fills in the defaults', () => {
    const options = parseResultHandlesOptions({});
    expect(options).toMatchObject({
      thresholdBytes: 16 * 1024,
      ttlSeconds: 600,
      preview: { items: 5, chars: 500 },
      storage: { type: 'auto', memory: { maxEntries: 1000 } },
      namespace: 'result-handles',
    });
    expect(options.foldPolicy('any_tool', {}, { bytes: 1, fullName: 'app:any_tool', request: {} as never })).toBe(true);
  });

  it('keeps the options it is given', () => {
    const foldPolicy = () => false;
    const options = parseResultHandlesOptions({
      thresholdBytes: 4096,
      ttlSeconds: 30,
      preview: { items: 2 },
      foldPolicy,
      storage: { type: 'memory' },
      namespace: 'answers',
    });
    expect(options).toEqual({
      thresholdBytes: 4096,
      ttlSeconds: 30,
      preview: { items: 2, chars: 500 },
      foldPolicy,
      storage: { type: 'memory', memory: { maxEntries: 1000 } },
      namespace: 'answers',
    });
  });

  it('caps the memory store at 1000 answers unless told otherwise', () => {
    expect(DEFAULT_MEMORY_MAX_ENTRIES).toBe(1000);
    const unlimited = parseResultHandlesOptions({ storage: { type: 'memory', memory: { maxEntries: 0 } } });
    expect(unlimited.storage).toEqual({ type: 'memory', memory: { maxEntries: 0 } });
    const swept = parseResultHandlesOptions({ storage: { type: 'auto', memory: { sweepIntervalSeconds: 5 } } });
    expect(swept.storage).toEqual({ type: 'auto', memory: { maxEntries: 1000, sweepIntervalSeconds: 5 } });
  });

  it.each([
    [{ thresholdBytes: MIN_THRESHOLD_BYTES - 1 }, 'thresholdBytes: must be a whole number of at least 1024'],
    [{ thresholdBytes: 2048.5 }, 'thresholdBytes: must be a whole number of at least 1024'],
    [{ ttlSeconds: 0 }, 'ttlSeconds: must be a whole number of seconds, at least 1'],
    [{ preview: { items: 0 } }, 'preview.items: must be a whole number, at least 1'],
    [{ preview: { chars: -1 } }, 'preview.chars: must be a whole number, at least 1'],
    [{ foldPolicy: 'always' }, 'foldPolicy: must be a function (toolName, answer, context) => boolean'],
    [{ storage: 'memory' }, 'storage: must be a storage config, such as { type: "redis", redis: { url } }'],
    [{ namespace: '' }, 'namespace: must not be empty'],
    [{ tresholdBytes: 4096 }, 'Unrecognized key: "tresholdBytes"'],
  ])('refuses %j', (input, message) => {
    expect(() => parseResultHandlesOptions(input as never)).toThrow(ResultHandlesConfigurationError);
    expect(() => parseResultHandlesOptions(input as never)).toThrow(message);
  });

  it('takes extra providers beside its options, as every plugin init() does', () => {
    const extra = { name: 'extra', provide: Symbol('EXTRA'), useValue: 1 };

    const record = ResultHandlesPlugin.init({ thresholdBytes: 4096, providers: [extra] });

    expect(record.providers).toContain(extra);
  });

  it('refuses invalid options when the plugin is created', () => {
    expect(() => ResultHandlesPlugin.init({ thresholdBytes: 10 })).toThrow(ResultHandlesConfigurationError);
    expect(() => new ResultHandlesPlugin({ ttlSeconds: -5 })).toThrow(ResultHandlesConfigurationError);
  });
});
