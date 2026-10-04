import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { createRememberMemoryProvider } from '../providers/remember-storage.provider';
import { rememberThisInputSchema } from '../tools/remember-this.tool';

describe('createRememberMemoryProvider', () => {
  it('stores and reads values once initialized', async () => {
    const provider = createRememberMemoryProvider();
    await provider.initialize();
    try {
      await provider.setValue('theme', 'dark');
      await expect(provider.getValue('theme')).resolves.toBe('dark');
    } finally {
      await provider.close();
    }
  });
});

describe('remember_this input', () => {
  const input = z.object(rememberThisInputSchema);

  it('accepts a whole number of seconds for ttl', () => {
    expect(input.safeParse({ key: 'theme', value: 'dark', ttl: 60 }).success).toBe(true);
  });

  it.each([1.5, 0, -1])('refuses a ttl of %p seconds, which a Redis store cannot apply', (ttl) => {
    expect(input.safeParse({ key: 'theme', value: 'dark', ttl }).success).toBe(false);
  });
});
