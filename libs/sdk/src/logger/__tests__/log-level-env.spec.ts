/**
 * `FRONTMCP_LOG_LEVEL` sets the log level of a server whose `logging.level` isn't set: what
 * `@frontmcp/testing`'s `test.use({ logLevel })` hands the server it boots.
 */
import { loggingOptionsSchema, LogLevel } from '../../common';

describe('FRONTMCP_LOG_LEVEL', () => {
  const originalLogLevel = process.env['FRONTMCP_LOG_LEVEL'];

  afterEach(() => {
    if (originalLogLevel === undefined) delete process.env['FRONTMCP_LOG_LEVEL'];
    else process.env['FRONTMCP_LOG_LEVEL'] = originalLogLevel;
  });

  it.each([
    ['debug', LogLevel.Debug],
    ['WARN', LogLevel.Warn],
    ['error', LogLevel.Error],
    ['off', LogLevel.Off],
  ])('makes %s the default level', (name, level) => {
    process.env['FRONTMCP_LOG_LEVEL'] = name;

    expect(loggingOptionsSchema.parse({}).level).toBe(level);
  });

  it('leaves a configured level and an unknown name alone', () => {
    process.env['FRONTMCP_LOG_LEVEL'] = 'debug';
    expect(loggingOptionsSchema.parse({ level: LogLevel.Error }).level).toBe(LogLevel.Error);

    process.env['FRONTMCP_LOG_LEVEL'] = 'loud';
    expect(loggingOptionsSchema.parse({}).level).toBe(LogLevel.Info);
  });
});

describe('default log level in a browser (#824)', () => {
  function browserSchema(): typeof import('../../common') {
    let schemaModule: typeof import('../../common') | undefined;
    jest.isolateModules(() => {
      jest.doMock('@frontmcp/utils', () => ({
        ...jest.requireActual('@frontmcp/utils'),
        getRuntimeContext: () => ({ runtime: 'browser' }),
      }));
      schemaModule = require('../../common');
    });
    jest.dontMock('@frontmcp/utils');
    if (!schemaModule) throw new Error('the logging schema did not load');
    return schemaModule;
  }

  it('is warn when no level is configured', () => {
    expect(browserSchema().loggingOptionsSchema.parse({}).level).toBe(LogLevel.Warn);
  });

  it('leaves a configured level alone', () => {
    expect(browserSchema().loggingOptionsSchema.parse({ level: LogLevel.Info }).level).toBe(LogLevel.Info);
  });
});
