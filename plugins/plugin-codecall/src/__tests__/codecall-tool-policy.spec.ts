/**
 * Discovery and execution must judge a tool by the same subject (GHSA-6w3j-82v5-6qrr).
 *
 * An entry registered in app `crm` as `admin:deleteUser` carries the qualified name
 * `crm:admin:deleteUser`. Search handed `includeTools` the bare name while execution handed it the
 * qualified one, so the documented filter `!tool.name.startsWith('admin:')` hid the tool from search
 * and let `callTool` run it.
 */
import type { ScopeEntry, ToolEntry } from '@frontmcp/sdk';

import type { CodeCallToolMetadata, IncludeToolsFilterToolInfo } from '../codecall.types';
import { checkCodeCallToolAccess, checkDirectCallPolicy, toCodeCallPolicyTool } from '../security/codecall-tool-policy';
import { ToolSearchService } from '../services/tool-search.service';

interface EntryOptions {
  appId?: string;
  description?: string;
  tags?: string[];
  codecall?: CodeCallToolMetadata;
  visibility?: 'public' | 'hidden' | 'internal';
}

function appEntry(name: string, options: EntryOptions = {}) {
  const ownerId = options.appId ?? 'crm';
  return {
    name,
    fullName: `${ownerId}:${name}`,
    owner: { kind: 'app', id: ownerId },
    metadata: {
      name,
      description: options.description ?? `Runs ${name}`,
      tags: options.tags,
      codecall: options.codecall,
      visibility: options.visibility,
    },
  };
}

type AppEntry = ReturnType<typeof appEntry>;

function scopeWith(entries: AppEntry[]): ScopeEntry {
  const tools = {
    getTools: () => entries,
    subscribe: (_options: unknown, listener: (event: { snapshot: AppEntry[] }) => void) => {
      listener({ snapshot: entries });
      return () => undefined;
    },
  };
  return { tools } as unknown as ScopeEntry;
}

function configReader(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] };
}

async function indexedToolNames(
  entries: AppEntry[],
  includeTools?: (info: IncludeToolsFilterToolInfo) => boolean,
): Promise<string[]> {
  const service = new ToolSearchService({ strategy: 'tfidf', includeTools }, scopeWith(entries));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const names = service.getAllToolNames();
  service.dispose();
  return names;
}

const excludeAdminTools = (tool: IncludeToolsFilterToolInfo) => !tool.name.startsWith('admin:');

describe('CodeCall tool policy subject (GHSA-6w3j-82v5-6qrr)', () => {
  it('hands includeTools the identical object in search indexing and in execution', async () => {
    const entry = appEntry('admin:deleteUser', { tags: ['users'], codecall: { source: 'inline' } });
    const includeTools = jest.fn((_info: IncludeToolsFilterToolInfo) => true);

    await indexedToolNames([entry], includeTools);
    checkCodeCallToolAccess(scopeWith([entry]), configReader({ includeTools }), 'admin:deleteUser');

    const [searchInfo, executionInfo] = includeTools.mock.calls.map(([info]) => info);
    expect(executionInfo).toEqual(searchInfo);
    expect(searchInfo).toEqual({
      name: 'admin:deleteUser',
      appId: 'crm',
      source: 'inline',
      description: 'Runs admin:deleteUser',
      tags: ['users'],
    });
  });

  it.each(['admin:deleteUser', 'crm:admin:deleteUser'])(
    'denies execution of a tool includeTools excludes, requested as "%s"',
    (requestedName) => {
      const entries = [appEntry('admin:deleteUser')];

      const access = checkCodeCallToolAccess(
        scopeWith(entries),
        configReader({ includeTools: excludeAdminTools }),
        requestedName,
      );

      expect(access).toEqual({
        allowed: false,
        reason: 'Tool "admin:deleteUser" is excluded by the includeTools filter',
      });
    },
  );

  it('keeps a tool includeTools excludes out of the search index', async () => {
    const names = await indexedToolNames([appEntry('admin:deleteUser'), appEntry('users:list')], excludeAdminTools);

    expect(names).toEqual(['users:list']);
  });

  it.each(['system:wipeConfig', 'internal:dumpState', '__debugDump'])(
    'keeps the default-blocked namespace %s out of the search index',
    async (name) => {
      const names = await indexedToolNames([appEntry(name), appEntry('users:list')]);

      expect(names).toEqual(['users:list']);
    },
  );

  it('blocks a namespace reached through the qualified name, in search and in execution', async () => {
    const entries = [appEntry('wipeConfig', { appId: 'system' }), appEntry('users:list')];

    expect(await indexedToolNames(entries)).toEqual(['users:list']);
    expect(checkCodeCallToolAccess(scopeWith(entries), configReader({}), 'wipeConfig')).toEqual({
      allowed: false,
      reason: 'Tool "system:wipeConfig" is in a namespace CodeCall never calls',
    });
  });

  it('treats visibility "hidden" like hideFromDiscovery, in search and in execution', async () => {
    const entries = [appEntry('users:purge', { visibility: 'hidden' }), appEntry('users:list')];

    expect(await indexedToolNames(entries)).toEqual(['users:list']);
    expect(checkCodeCallToolAccess(scopeWith(entries), configReader({}), 'users:purge').allowed).toBe(false);
  });

  it('returns the resolved entry with an allow decision', () => {
    const entry = appEntry('get_report');

    const access = checkCodeCallToolAccess(scopeWith([entry]), configReader({}), 'get-report');

    expect(access).toEqual({ allowed: true, entry });
  });

  it('builds the policy subject from a real ToolEntry shape without a cast', () => {
    const entry: Pick<ToolEntry, 'name' | 'fullName' | 'owner' | 'metadata'> = {
      name: 'users:list',
      fullName: 'crm:users:list',
      owner: { kind: 'app', id: 'crm', ref: class CrmApp {} },
      metadata: { name: 'users:list', inputSchema: {}, hideFromDiscovery: true },
    };

    expect(toCodeCallPolicyTool(entry, 'users:list')).toMatchObject({
      name: 'users:list',
      fullName: 'crm:users:list',
      aliases: ['users:list'],
      appId: 'crm',
      hidden: true,
    });
  });
});

describe('CodeCall directCalls.allowedTools matching (GHSA-6w3j-82v5-6qrr)', () => {
  const usersList = () => toCodeCallPolicyTool(appEntry('users:list'));

  it.each([['users:list'], ['crm:users:list']])('allows a tool listed as "%s"', (listedName) => {
    expect(checkDirectCallPolicy(usersList(), { enabled: true, allowedTools: [listedName] })).toEqual({
      allowed: true,
    });
  });

  it('denies a tool that is not listed', () => {
    expect(checkDirectCallPolicy(usersList(), { enabled: true, allowedTools: ['users:get'] }).allowed).toBe(false);
  });

  it('never allows through the name the caller asked for, only through the entry’s own names', () => {
    const resolvedByAlias = toCodeCallPolicyTool(appEntry('get_report'), 'get-report');

    expect(checkDirectCallPolicy(resolvedByAlias, { enabled: true, allowedTools: ['get-report'] }).allowed).toBe(false);
  });

  it('hands directCalls.filter the same bare name includeTools receives', () => {
    const filter = jest.fn(() => true);

    checkDirectCallPolicy(usersList(), { enabled: true, filter });

    expect(filter).toHaveBeenCalledWith(expect.objectContaining({ name: 'users:list', appId: 'crm' }));
  });
});
