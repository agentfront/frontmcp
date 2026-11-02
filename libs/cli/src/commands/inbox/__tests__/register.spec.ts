import { Command } from 'commander';

import { InboxError } from '../inbox';
import { registerInboxCommands } from '../register';

const runInbox = jest.fn();

jest.mock(
  '../inbox.js',
  () => ({ ...jest.requireActual('../inbox'), runInbox: (...args: unknown[]) => runInbox(...args) }),
  {
    virtual: true,
  },
);

function program(): Command {
  const root = new Command().exitOverride();
  registerInboxCommands(root);
  return root;
}

describe('frontmcp inbox', () => {
  afterEach(() => {
    runInbox.mockReset();
    process.exitCode = undefined;
  });

  it('passes the link and the options on', async () => {
    await program().parseAsync(['inbox', 'abc', '--url', 'http://127.0.0.1:3000', '--answer', 'q-1', '--decline'], {
      from: 'user',
    });

    expect(runInbox).toHaveBeenCalledWith(
      'abc',
      expect.objectContaining({ url: 'http://127.0.0.1:3000', answer: 'q-1', decline: true }),
    );
  });

  it('prints a refusal and exits with 1, without a stack', async () => {
    runInbox.mockRejectedValue(new InboxError('Sign-in refused (401): no'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await program().parseAsync(['inbox', 'abc'], { from: 'user' });

    expect(error).toHaveBeenCalledWith(expect.stringContaining('Sign-in refused (401): no'));
    expect(process.exitCode).toBe(1);
    error.mockRestore();
  });

  it('lets any other failure through', async () => {
    runInbox.mockRejectedValue(new Error('boom'));

    await expect(program().parseAsync(['inbox', 'abc'], { from: 'user' })).rejects.toThrow('boom');
  });
});
