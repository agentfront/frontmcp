/**
 * `ChallengeService.markWebhookSent()` against a callback that uses the challenge at the same time.
 */
import 'reflect-metadata';

import { createMemoryStorage, MemoryStorageAdapter, type RootStorage } from '@frontmcp/utils';

import { ChallengeService } from '../services/challenge.service';

describe('ChallengeService.markWebhookSent()', () => {
  let storage: RootStorage;
  let service: ChallengeService;

  beforeEach(async () => {
    storage = createMemoryStorage();
    await storage.connect();
    service = new ChallengeService({ storageInstance: storage });
    await service.initialize();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await service.close();
    await storage.disconnect();
  });

  it('does not bring back a challenge a callback used while it was marking it', async () => {
    const { codeVerifier, codeChallenge } = await service.createChallenge({
      toolId: 'ops:deploy',
      sessionId: 'session-alice',
      requestedScope: 'session',
      requestInfo: { toolName: 'deploy' },
    });
    const readStored = MemoryStorageAdapter.prototype.get;
    jest.spyOn(MemoryStorageAdapter.prototype, 'get').mockImplementationOnce(async function (
      this: MemoryStorageAdapter,
      key: string,
    ) {
      const stored = await readStored.call(this, key);
      await service.consume(codeVerifier);
      return stored;
    });

    expect(await service.markWebhookSent(codeChallenge)).toBe(false);
    expect(await service.consume(codeVerifier)).toBeUndefined();
  });

  it('marks a pending challenge as sent and keeps it usable', async () => {
    const { codeVerifier, codeChallenge } = await service.createChallenge({
      toolId: 'ops:deploy',
      sessionId: 'session-alice',
      requestedScope: 'session',
      requestInfo: { toolName: 'deploy' },
    });

    expect(await service.markWebhookSent(codeChallenge)).toBe(true);
    expect((await service.consume(codeVerifier))?.webhookSent).toBe(true);
  });
});
