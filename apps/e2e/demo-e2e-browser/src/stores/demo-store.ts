import { createValtioStore } from '@frontmcp/plugin-store';

export const counterStore = createValtioStore({
  count: 0,
  history: [] as number[],
});

export const todoStore = createValtioStore({
  items: [
    { id: 1, text: 'Learn FrontMCP', done: true },
    { id: 2, text: 'Build a store plugin', done: false },
    { id: 3, text: 'Add browser support', done: false },
  ],
  filter: 'all' as 'all' | 'active' | 'done',
});
