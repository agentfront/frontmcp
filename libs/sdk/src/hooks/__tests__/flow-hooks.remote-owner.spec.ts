import 'reflect-metadata';

import { type ScopeEntry } from '../../common';
import CompleteFlow from '../../completion/flows/complete.flow';
import GetPromptFlow from '../../prompt/flows/get-prompt.flow';
import ReadResourceFlow from '../../resource/flows/read-resource.flow';

const REMOTE_APP_OWNER = { kind: 'app', id: 'remote-crm' } as const;

function createScopeWithLazyRemoteApp(): ScopeEntry {
  let capabilitiesLoaded = false;
  const remotePrompt = { owner: REMOTE_APP_OWNER };
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
