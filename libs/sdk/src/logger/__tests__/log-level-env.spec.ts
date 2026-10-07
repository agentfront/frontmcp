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
