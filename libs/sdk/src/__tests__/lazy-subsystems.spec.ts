/**
 * The CommonJS build's `./subsystems` (`lazy-subsystems.ts`) exports what `subsystems.ts` exports, and loads a
 * subsystem the first time one of its exports is read (#950).
 */
describe('lazy-subsystems', () => {
  afterEach(() => {
    jest.dontMock('../job');
    jest.resetModules();
  });

  it('exports the values subsystems.ts exports', () => {
    const lazySubsystems = require('../lazy-subsystems');
    const subsystems = require('../subsystems');

    expect(Object.keys(lazySubsystems).sort()).toEqual(Object.keys(subsystems).sort());
    for (const name of Object.keys(subsystems)) {
      expect(lazySubsystems[name]).toBe(subsystems[name]);
    }
  });

  it('loads a subsystem the first time one of its exports is read', () => {
    const JobRegistry = class {};
    const loadJob = jest.fn(() => ({ JobRegistry }));
    jest.doMock('../job', loadJob);

    jest.isolateModules(() => {
      const lazySubsystems = require('../lazy-subsystems');
      expect(loadJob).not.toHaveBeenCalled();

      expect(lazySubsystems.JobRegistry).toBe(JobRegistry);
      expect(lazySubsystems.JobRegistry).toBe(JobRegistry);
      expect(loadJob).toHaveBeenCalledTimes(1);
    });
  });
});
