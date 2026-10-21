describe('lazy-js-yaml', () => {
  afterEach(() => {
    jest.dontMock('js-yaml');
    jest.resetModules();
  });

  it('loads js-yaml the first time one of its functions is read', () => {
    const load = jest.fn();
    const loadJsYaml = jest.fn(() => ({ load, dump: jest.fn() }));
    jest.doMock('js-yaml', loadJsYaml);

    jest.isolateModules(() => {
      const lazyYaml = require('../lazy-js-yaml');
      expect(loadJsYaml).not.toHaveBeenCalled();

      expect(lazyYaml.load).toBe(load);
      expect(loadJsYaml).toHaveBeenCalledTimes(1);
    });
  });

  it('exports the functions the eager module exports', () => {
    const lazyYaml = require('../lazy-js-yaml');
    const eagerYaml = require('../js-yaml');

    expect(Object.keys(lazyYaml).sort()).toEqual(Object.keys(eagerYaml).sort());
    expect(lazyYaml.load).toBe(eagerYaml.load);
    expect(lazyYaml.dump).toBe(eagerYaml.dump);
    expect(lazyYaml.load('a: 1')).toEqual({ a: 1 });
  });
});
