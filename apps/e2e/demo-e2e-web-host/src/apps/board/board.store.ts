import { resourceStore } from '@frontmcp/sdk';

export const boardStore = resourceStore();

export const board = boardStore.key<string[]>('board', { initial: [] });
