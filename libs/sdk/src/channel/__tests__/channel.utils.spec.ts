import 'reflect-metadata';

import { channelCapabilitiesOf, channelMetaOf, servesClaudeCodeChannels } from '../channel.utils';

const withChannel = { hasAny: () => true };
const withoutChannel = { hasAny: () => false };
const withChannelEvent = { getChannelEvents: () => [{ name: 'order.created' }] };
const withoutChannelEvent = { getChannelEvents: () => [] };

describe('channelMetaOf', () => {
  it('keeps a key of letters, digits and underscores as it is', () => {
    expect(channelMetaOf({ env: 'prod', order_id: 'o-1', Region2: 'eu' })).toEqual({
      env: 'prod',
      order_id: 'o-1',
      Region2: 'eu',
    });
  });

  it.each([
    ['chat-id', 'chat_id'],
    ['user.name', 'user_name'],
    ['two words', 'two_words'],
    ['x-request-id', 'x_request_id'],
    ['café', 'caf_'],
    ['-', '_'],
  ])('turns the key %p into %p, which Claude Code does not drop', (key, safeKey) => {
    expect(channelMetaOf({ [key]: 'value' })).toEqual({ [safeKey]: 'value' });
  });

  it('leaves out an empty key', () => {
    expect(channelMetaOf({ '': 'nameless', env: 'prod' })).toEqual({ env: 'prod' });
  });

  it('sends every value as a string, an object as JSON, and leaves out one that is not there', () => {
    const meta = { attempt: 3, urgent: true, note: '', order: { id: 'o-1' }, tags: ['a', 'b'], owner: undefined };

    expect(channelMetaOf({ ...meta, team: null })).toEqual({
      attempt: '3',
      urgent: 'true',
      note: '',
      order: '{"id":"o-1"}',
      tags: '["a","b"]',
    });
  });

  it.each([
    [
      'a cyclic object',
      () => {
        const cyclic: Record<string, unknown> = { id: 'o-1' };
        cyclic['self'] = cyclic;
        return cyclic;
      },
    ],
    ['an object that holds a BigInt', () => ({ total: 1n })],
  ])('sends %s, which has no JSON, as String() gives it', (_label, value) => {
    expect(channelMetaOf({ order: value(), env: 'prod' })).toEqual({ order: '[object Object]', env: 'prod' });
  });
});

describe('servesClaudeCodeChannels', () => {
  it('is true for a scope with a channel', () => {
    expect(servesClaudeCodeChannels({ channels: withChannel })).toBe(true);
  });

  it('is true for a scope with an event that has the channel option, and no channel', () => {
    expect(servesClaudeCodeChannels({ events: withChannelEvent })).toBe(true);
    expect(servesClaudeCodeChannels({ channels: withoutChannel, events: withChannelEvent })).toBe(true);
  });

  it('is false for a scope with neither', () => {
    expect(servesClaudeCodeChannels({})).toBe(false);
    expect(servesClaudeCodeChannels({ channels: withoutChannel, events: withoutChannelEvent })).toBe(false);
  });
});

describe('channelCapabilitiesOf', () => {
  it('advertises claude/channel for a scope that pushes into Claude Code sessions', () => {
    const capability = { experimental: { 'claude/channel': {} } };

    expect(channelCapabilitiesOf({ channels: withChannel })).toEqual(capability);
    expect(channelCapabilitiesOf({ events: withChannelEvent })).toEqual(capability);
  });

  it('advertises nothing for a scope that does not', () => {
    expect(channelCapabilitiesOf({ channels: withoutChannel, events: withoutChannelEvent })).toEqual({});
  });
});
