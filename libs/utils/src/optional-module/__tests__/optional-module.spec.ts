import { registerOptionalModule, requireOptionalModule } from '../optional-module';

describe('registerOptionalModule / requireOptionalModule', () => {
  it('runs the loader when nothing is registered', () => {
    const load = jest.fn(() => ({ source: 'require' }));

    expect(requireOptionalModule('@frontmcp/not-registered', load)).toEqual({ source: 'require' });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('returns a module the bundle registered without calling the loader', () => {
    const bundled = { source: 'bundle' };
    registerOptionalModule('@frontmcp/registered-package', bundled);
    const load = jest.fn();

    expect(requireOptionalModule('@frontmcp/registered-package', load)).toBe(bundled);
    expect(load).not.toHaveBeenCalled();
  });

  it('shares the registry with another copy of the package in the same process', () => {
    registerOptionalModule('@frontmcp/shared-package', { source: 'bundle' });

    jest.isolateModules(() => {
      const otherCopy = require('../optional-module') as typeof import('../optional-module');
      expect(otherCopy.requireOptionalModule).not.toBe(requireOptionalModule);
      expect(otherCopy.requireOptionalModule('@frontmcp/shared-package', jest.fn())).toEqual({ source: 'bundle' });
    });
  });
});
