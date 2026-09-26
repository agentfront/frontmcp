/** A configured `ipFilter` must decide a request with no client IP by `defaultAction`, not wave it through (GHSA-hwfp-xv2f-fr8g). */
import type { NamespacedStorage } from '@frontmcp/utils';

import { GuardManager } from '../guard.manager';
import type { GuardConfig } from '../types';

const unusedStorage = {} as NamespacedStorage;

function managerWith(ipFilter: GuardConfig['ipFilter']): GuardManager {
  return new GuardManager(unusedStorage, { enabled: true, ipFilter });
}

describe('GuardManager.checkIpFilter with no client IP (GHSA-hwfp-xv2f-fr8g)', () => {
  it.each([undefined, ''])('rejects a request with client IP %p when defaultAction is deny', (clientIp) => {
    const manager = managerWith({ allowList: ['10.0.0.0/8'], defaultAction: 'deny' });

    expect(manager.checkIpFilter(clientIp)).toEqual({ allowed: false, reason: 'default' });
  });

  it('allows a request with no client IP when defaultAction is allow', () => {
    const manager = managerWith({ denyList: ['10.0.0.0/8'], defaultAction: 'allow' });

    expect(manager.checkIpFilter(undefined)).toEqual({ allowed: true, reason: 'default' });
  });

  it('treats a missing defaultAction as allow, the documented default', () => {
    const manager = managerWith({ denyList: ['10.0.0.0/8'] });

    expect(manager.checkIpFilter(undefined)).toEqual({ allowed: true, reason: 'default' });
  });

  it('decides the same way for no IP and for an IP it cannot parse', () => {
    const manager = managerWith({ allowList: ['10.0.0.0/8'], defaultAction: 'deny' });

    expect(manager.checkIpFilter(undefined)).toEqual(manager.checkIpFilter('not-an-ip'));
  });

  it('still makes no decision when no ipFilter is configured', () => {
    const manager = new GuardManager(unusedStorage, { enabled: true });

    expect(manager.checkIpFilter(undefined)).toBeUndefined();
  });

  it('never allow-lists a request with no client IP', () => {
    const manager = managerWith({ allowList: ['0.0.0.0/0'], defaultAction: 'deny' });

    expect(manager.isIpAllowListed(undefined)).toBe(false);
  });
});
