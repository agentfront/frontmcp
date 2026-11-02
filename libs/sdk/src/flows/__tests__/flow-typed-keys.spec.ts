import { parseTypedKey } from '../flow.instance';

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
