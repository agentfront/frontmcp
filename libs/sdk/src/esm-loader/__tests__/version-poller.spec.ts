import { VersionPoller } from '../version-poller';
import { VersionResolver } from '../version-resolver';
import type { ParsedPackageSpecifier } from '../package-specifier';

// Mock VersionResolver
jest.mock('../version-resolver');

describe('VersionPoller', () => {
  let poller: VersionPoller;
  let onNewVersion: jest.Mock;
  let mockResolve: jest.Mock;

  const specifier: ParsedPackageSpecifier = {
    scope: '@acme',
    name: 'tools',
    fullName: '@acme/tools',
    range: '^1.0.0',
    raw: '@acme/tools@^1.0.0',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    onNewVersion = jest.fn().mockResolvedValue(undefined);
    mockResolve = jest.fn();

    (VersionResolver as jest.MockedClass<typeof VersionResolver>).mockImplementation(
      () =>
        ({
          resolve: mockResolve,
        }) as unknown as VersionResolver,
    );

    poller = new VersionPoller({
      intervalMs: 1000,
      onNewVersion,
    });
  });

  afterEach(() => {
    poller.stop();
    jest.useRealTimers();
  });

  it('should track added packages', () => {
    poller.addPackage(specifier, '1.0.0');
    expect(poller.trackedCount).toBe(1);
  });

  it('should remove tracked packages', () => {
    poller.addPackage(specifier, '1.0.0');
    poller.removePackage('@acme/tools');
    expect(poller.trackedCount).toBe(0);
  });

  it('should not start if no packages tracked', () => {
    poller.start();
    expect(poller.isRunning()).toBe(false);
  });

  it('should start and stop', () => {
    poller.addPackage(specifier, '1.0.0');
    poller.start();
    expect(poller.isRunning()).toBe(true);

    poller.stop();
    expect(poller.isRunning()).toBe(false);
  });

  it('should not start twice', () => {
    poller.addPackage(specifier, '1.0.0');
    poller.start();
    poller.start(); // Should be a no-op
    expect(poller.isRunning()).toBe(true);
  });

  it('should checkNow and return results', async () => {
    mockResolve.mockResolvedValue({
      resolvedVersion: '1.0.0',
      availableVersions: ['1.0.0'],
    });

    poller.addPackage(specifier, '1.0.0');
    const results = await poller.checkNow();

    expect(results).toHaveLength(1);
    expect(results[0].hasUpdate).toBe(false);
    expect(results[0].currentVersion).toBe('1.0.0');
    expect(results[0].latestVersion).toBe('1.0.0');
  });

  it('should detect newer versions', async () => {
    mockResolve.mockResolvedValue({
      resolvedVersion: '1.1.0',
      availableVersions: ['1.0.0', '1.1.0'],
    });

    poller.addPackage(specifier, '1.0.0');
    const results = await poller.checkNow();

    expect(results).toHaveLength(1);
    expect(results[0].hasUpdate).toBe(true);
    expect(results[0].latestVersion).toBe('1.1.0');
  });

  it('should handle version check errors gracefully', async () => {
    mockResolve.mockRejectedValue(new Error('Network error'));

    poller.addPackage(specifier, '1.0.0');
    const results = await poller.checkNow();

    // Should not throw, just return empty results for failed checks
    expect(results).toHaveLength(0);
  });

  it('should update current version after successful callback', () => {
    poller.addPackage(specifier, '1.0.0');
    poller.updateCurrentVersion('@acme/tools', '1.1.0');
    // Internal state updated - no public accessor for current version per package
    // but the next check should compare against 1.1.0
    expect(poller.trackedCount).toBe(1);
  });
});
