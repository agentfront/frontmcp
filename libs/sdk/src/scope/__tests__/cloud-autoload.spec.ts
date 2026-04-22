import 'reflect-metadata';

import { loadCloudProvider } from '../cloud-autoload';

function createLogger() {
  return {
    warn: jest.fn(),
    verbose: jest.fn(),
  };
}

describe('loadCloudProvider', () => {
  it('returns undefined when cloud is not set', () => {
    const logger = createLogger();
    const resolver = jest.fn();
    expect(loadCloudProvider(undefined, logger, resolver)).toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns undefined when cloud is an empty object', () => {
    const logger = createLogger();
    const resolver = jest.fn();
    expect(loadCloudProvider({}, logger, resolver)).toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('returns undefined when cloud is null', () => {
    const logger = createLogger();
    const resolver = jest.fn();
    expect(loadCloudProvider(null, logger, resolver)).toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('returns undefined when cloud is not an object', () => {
    const logger = createLogger();
    const resolver = jest.fn();
    expect(loadCloudProvider('not-an-object', logger, resolver)).toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('returns contributions when the provider is resolvable', () => {
    const logger = createLogger();
    const contributions = { plugins: [{ id: 'p1' }] };
    const provider = {
      name: 'frontegg',
      contribute: jest.fn().mockReturnValue(contributions),
      bootstrap: jest.fn(),
    };
    const resolver = jest.fn().mockReturnValue({ cloudProvider: provider });

    const cloud = { clientId: 'abc', secret: 'xyz' };
    const result = loadCloudProvider(cloud, logger, resolver);

    expect(result).toBeDefined();
    expect(result?.provider).toBe(provider);
    expect(result?.contributions).toBe(contributions);
    expect(provider.contribute).toHaveBeenCalledTimes(1);
    expect(provider.contribute).toHaveBeenCalledWith(cloud);
    expect(logger.verbose).toHaveBeenCalledWith(
      expect.stringContaining("cloud: loaded provider 'frontegg'"),
      expect.any(Object),
    );
  });

  it('warns and returns undefined when the provider package is not installed', () => {
    const logger = createLogger();
    const resolver = jest.fn().mockImplementation(() => {
      throw new Error('MODULE_NOT_FOUND');
    });

    const result = loadCloudProvider({ clientId: 'abc', secret: 'xyz' }, logger, resolver);

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('cloud provider package is not installed'));
  });

  it('warns and returns undefined when the resolved module lacks cloudProvider', () => {
    const logger = createLogger();
    const resolver = jest.fn().mockReturnValue({ notTheRightExport: {} });

    const result = loadCloudProvider({ clientId: 'abc', secret: 'xyz' }, logger, resolver);

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('does not export `cloudProvider`'));
  });

  it('warns but returns the provider with undefined contributions when contribute() throws', () => {
    const logger = createLogger();
    const provider = {
      name: 'frontegg',
      contribute: jest.fn().mockImplementation(() => {
        throw new Error('boom');
      }),
    };
    const resolver = jest.fn().mockReturnValue({ cloudProvider: provider });

    const result = loadCloudProvider({ clientId: 'abc', secret: 'xyz' }, logger, resolver);

    expect(result).toEqual({ provider, contributions: undefined });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("provider 'frontegg' contribute() failed"),
      expect.objectContaining({ error: 'boom' }),
    );
  });

  it('uses the default resolver when none is passed', () => {
    const logger = createLogger();
    // Default resolver requires @frontmcp/plugin-frontegg which isn't
    // installed in the OSS workspace — warns and returns undefined.
    const result = loadCloudProvider({ clientId: 'abc', secret: 'xyz' }, logger);
    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
