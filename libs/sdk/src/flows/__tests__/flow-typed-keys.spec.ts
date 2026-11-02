import { parseTypedKey, stageBasesOf } from '../flow.instance';

describe('parseTypedKey', () => {
  it.each([
    ['willExecute', 'will'],
    ['didExecute', 'did'],
    ['aroundExecute', 'around'],
    ['finallyExecute', 'finally'],
  ] as const)('reads %s as a %s hook key of the execute stage, never as a stage of its own', (key, type) => {
    expect(parseTypedKey(key)).toEqual({ base: 'execute', type });
  });

  it.each(['execute', 'finalize', 'finally', 'will'])('reads %s as a plain stage name', (key) => {
    expect(parseTypedKey(key)).toEqual({ base: key });
  });
});

describe('stageBasesOf', () => {
  it('runs a typed key with its base stage, never as a stage of its own', () => {
    expect(stageBasesOf(['execute', 'finallyExecute', 'willExecute'])).toEqual(['execute']);
  });

  it('keeps a stage named finally<Something> a stage when the group lists no <something> stage, as before Finally hooks', () => {
    expect(stageBasesOf(['parse', 'finallyCheck'])).toEqual(['parse', 'finallyCheck']);
  });
});
