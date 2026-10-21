describe('lazy-uipack-render', () => {
  afterEach(() => {
    jest.dontMock('@frontmcp/uipack');
    jest.resetModules();
  });

  it('loads @frontmcp/uipack the first time one of its functions is read', () => {
    const renderComponent = jest.fn();
    const loadUipack = jest.fn(() => ({ renderComponent, createResolverWithOverrides: jest.fn() }));
    jest.doMock('@frontmcp/uipack', loadUipack);

    jest.isolateModules(() => {
      const lazyRender = require('../lazy-uipack-render');
      expect(loadUipack).not.toHaveBeenCalled();

      expect(lazyRender.renderComponent).toBe(renderComponent);
      expect(loadUipack).toHaveBeenCalledTimes(1);
    });
  });

  it('exports the functions the eager module exports', () => {
    const lazyRender = require('../lazy-uipack-render');
    const eagerRender = require('../uipack-render');

    expect(Object.keys(lazyRender).sort()).toEqual(Object.keys(eagerRender).sort());
    expect(lazyRender.renderComponent).toBe(eagerRender.renderComponent);
    expect(lazyRender.createResolverWithOverrides).toBe(eagerRender.createResolverWithOverrides);
  });
});
