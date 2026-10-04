import 'reflect-metadata';

import { createRememberMemoryProvider } from '../providers/remember-storage.provider';

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
