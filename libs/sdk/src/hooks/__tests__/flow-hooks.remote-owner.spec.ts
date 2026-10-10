import 'reflect-metadata';

import CallAgentFlow from '../../agent/flows/call-agent.flow';
import { type ScopeEntry } from '../../common';
import CompleteFlow from '../../completion/flows/complete.flow';
import GetPromptFlow from '../../prompt/flows/get-prompt.flow';
import ReadResourceFlow from '../../resource/flows/read-resource.flow';
import CallToolFlow from '../../tool/flows/call-tool.flow';

const REMOTE_APP_OWNER = { kind: 'app', id: 'remote-crm' } as const;

function createScopeWithLazyRemoteApp(): ScopeEntry {
  let capabilitiesLoaded = false;
  const remotePrompt = { owner: REMOTE_APP_OWNER, fullName: `${REMOTE_APP_OWNER.id}:remote-summary` };
  const remoteResource = { owner: REMOTE_APP_OWNER };
  const remoteApp = {
    id: REMOTE_APP_OWNER.id,
    isRemote: true,
    ensureCapabilitiesLoaded: async () => {
      capabilitiesLoaded = true;
    },
  };

  return {
    prompts: {
      findByName: (promptName: string) =>
        capabilitiesLoaded && promptName === 'remote-summary' ? remotePrompt : undefined,
      getPrompts: () => (capabilitiesLoaded ? [remotePrompt] : []),
      lineageOf: () => [REMOTE_APP_OWNER],
    },
    resources: {
      findResourceForUri: (uri: string) =>
        capabilitiesLoaded && uri === 'crm://accounts/1' ? { instance: remoteResource } : undefined,
      lineageOf: () => [REMOTE_APP_OWNER],
    },
    providers: { getRegistries: () => [{ getApps: () => [remoteApp] }] },
  } as unknown as ScopeEntry;
}

describe('hook owner of an entry a remote app loads lazily', () => {
  it('resolves the owning remote app for prompts/get before its capabilities are loaded', async () => {
    const rawInput = { request: { method: 'prompts/get', params: { name: 'remote-summary' } }, ctx: {} };

    await expect(GetPromptFlow.resolveHookOwnerId?.(rawInput, createScopeWithLazyRemoteApp())).resolves.toBe(
      REMOTE_APP_OWNER.id,
    );
  });

  it('resolves the owning app for the app-qualified prompt name prompts/list may give', async () => {
    const rawInput = {
      request: { method: 'prompts/get', params: { name: `${REMOTE_APP_OWNER.id}:remote-summary` } },
      ctx: {},
    };

    await expect(GetPromptFlow.resolveHookOwnerId?.(rawInput, createScopeWithLazyRemoteApp())).resolves.toBe(
      REMOTE_APP_OWNER.id,
    );
  });

  it('resolves the owning remote app for resources/read before its capabilities are loaded', async () => {
    const rawInput = { request: { method: 'resources/read', params: { uri: 'crm://accounts/1' } }, ctx: {} };

    await expect(ReadResourceFlow.resolveHookOwnerId?.(rawInput, createScopeWithLazyRemoteApp())).resolves.toBe(
      REMOTE_APP_OWNER.id,
    );
  });

  it('resolves the owning remote app for completion/complete before its capabilities are loaded', async () => {
    const rawInput = {
      request: {
        method: 'completion/complete',
        params: { ref: { type: 'ref/prompt', name: 'remote-summary' }, argument: { name: 'topic', value: '' } },
      },
      ctx: {},
    };

    await expect(CompleteFlow.resolveHookOwnerId?.(rawInput, createScopeWithLazyRemoteApp())).resolves.toBe(
      REMOTE_APP_OWNER.id,
    );
  });
});

describe('entry class of a run, for its static hooks (#701)', () => {
  it('names no class for a request that names no entry', () => {
    const scope = createScopeWithLazyRemoteApp();
    const nameless = { request: { method: 'x', params: {} }, ctx: {} };

    expect(CallToolFlow.resolveHookEntryClass?.(nameless, scope)).toBeUndefined();
    expect(GetPromptFlow.resolveHookEntryClass?.(nameless, scope)).toBeUndefined();
    expect(ReadResourceFlow.resolveHookEntryClass?.(nameless, scope)).toBeUndefined();
    expect(CallAgentFlow.resolveHookEntryClass?.(nameless, scope)).toBeUndefined();
  });

  it('names no agent class when the scope has no agent registry', () => {
    const rawInput = { request: { method: 'tools/call', params: { name: 'triage' } }, ctx: {} };

    expect(CallAgentFlow.resolveHookEntryClass?.(rawInput, createScopeWithLazyRemoteApp())).toBeUndefined();
  });

  it('names no class for an entry the scope does not know', () => {
    const scope = createScopeWithLazyRemoteApp();

    expect(
      GetPromptFlow.resolveHookEntryClass?.({ request: { params: { name: 'missing' } }, ctx: {} }, scope),
    ).toBeUndefined();
    expect(
      ReadResourceFlow.resolveHookEntryClass?.({ request: { params: { uri: 'missing://1' } }, ctx: {} }, scope),
    ).toBeUndefined();
  });
});
