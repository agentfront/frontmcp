import type { EntryOwnerRef } from '../../../common';
import {
  resolveRemoteAppOwner,
  type ResolveAppEntryLike,
  type ResolveAppsLike,
  type ResolveOwnerLogger,
} from '../resolve-remote-app-owner';

const REMOTE_TOKEN = Symbol.for('remote-token') as unknown as EntryOwnerRef['ref'];
const LOCAL_TOKEN = Symbol.for('local-token') as unknown as EntryOwnerRef['ref'];

const fallback: EntryOwnerRef = {
  kind: 'app',
  id: 'remote-app-id',
  ref: REMOTE_TOKEN,
};

function fakeApps(entries: Array<{ name?: string; token?: unknown }>): ResolveAppsLike {
  return {
    getApps: () =>
      entries.map(
        (e) =>
          ({
            metadata: { name: e.name },
            // token on AppEntry is `protected readonly`; the resolver reads
            // via structural cast, so we expose it directly on the fake.
            token: e.token,
          }) as ResolveAppEntryLike,
      ),
  };
}

function mkLogger(): { warnings: Array<{ msg: string }>; logger: ResolveOwnerLogger } {
  const warnings: Array<{ msg: string }> = [];
  return {
    warnings,
    logger: {
      warn: (msg: string) => {
        warnings.push({ msg });
      },
    },
  };
}

describe('resolveRemoteAppOwner', () => {
  it('returns fallback when ownerAppName is not set (opt-out path stays quiet)', () => {
    const { logger, warnings } = mkLogger();
    const result = resolveRemoteAppOwner({
      ownerAppName: undefined,
      fallback,
      apps: fakeApps([]),
      logger,
      remoteId: 'r-1',
    });
    expect(result).toBe(fallback);
    expect(warnings).toEqual([]);
  });

  it('returns an owner pointing at the matching local app when ownerAppName resolves', () => {
    const result = resolveRemoteAppOwner({
      ownerAppName: 'frontegg-managed',
      fallback,
      apps: fakeApps([{ name: 'frontegg-managed', token: LOCAL_TOKEN }]),
      remoteId: 'r-1',
    });
    expect(result).toEqual<EntryOwnerRef>({
      kind: 'app',
      id: 'frontegg-managed',
      ref: LOCAL_TOKEN,
    });
  });

  it('returns fallback + warns when the scope has no AppRegistry surface', () => {
    const { logger, warnings } = mkLogger();
    const result = resolveRemoteAppOwner({
      ownerAppName: 'frontegg-managed',
      fallback,
      apps: undefined,
      logger,
      remoteId: 'r-1',
    });
    expect(result).toBe(fallback);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].msg).toContain('no AppRegistry');
  });

  it('returns fallback + warns when ownerAppName does not match any contributed app', () => {
    const { logger, warnings } = mkLogger();
    const result = resolveRemoteAppOwner({
      ownerAppName: 'missing-app',
      fallback,
      apps: fakeApps([{ name: 'other-app', token: LOCAL_TOKEN }]),
      logger,
      remoteId: 'r-1',
    });
    expect(result).toBe(fallback);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].msg).toContain("ownerAppName='missing-app'");
    expect(warnings[0].msg).toContain('did not resolve');
  });

  it('returns fallback + warns when target app exists but has no token', () => {
    const { logger, warnings } = mkLogger();
    const result = resolveRemoteAppOwner({
      ownerAppName: 'broken-app',
      fallback,
      apps: fakeApps([{ name: 'broken-app', token: undefined }]),
      logger,
      remoteId: 'r-1',
    });
    expect(result).toBe(fallback);
    expect(warnings[0].msg).toContain('no token');
  });

  it('is silent when ownerAppName is unset even if registry is missing', () => {
    const { logger, warnings } = mkLogger();
    resolveRemoteAppOwner({
      ownerAppName: undefined,
      fallback,
      apps: undefined,
      logger,
      remoteId: 'r-1',
    });
    expect(warnings).toEqual([]);
  });
});
