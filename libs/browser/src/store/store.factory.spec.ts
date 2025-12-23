// file: libs/browser/src/store/store.factory.spec.ts
import { createMcpStore, createAction, createAsyncAction, createComputed, createSelector } from './store.factory';

interface TestState {
  count: number;
  items: string[];
  user: { name: string; age: number } | null;
}

describe('createMcpStore', () => {
  const createTestStore = (options?: Partial<Parameters<typeof createMcpStore<TestState>>[0]>) => {
    return createMcpStore<TestState>({
      initialState: {
        count: 0,
        items: [],
        user: null,
      },
      ...options,
    });
  };

  describe('basic functionality', () => {
    it('should create a store with initial state', () => {
      const store = createTestStore();
      expect(store.state.count).toBe(0);
      expect(store.state.items).toEqual([]);
      expect(store.state.user).toBeNull();
    });

    it('should allow reading state', () => {
      const store = createTestStore();
      const count = store.state.count;
      const items = store.state.items;
      expect(count).toBe(0);
      expect(items).toEqual([]);
    });

    it('should allow mutating state', () => {
      const store = createTestStore();
      store.state.count = 5;
      store.state.items.push('item1');
      store.state.user = { name: 'John', age: 30 };

      expect(store.state.count).toBe(5);
      expect(store.state.items).toEqual(['item1']);
      expect(store.state.user).toEqual({ name: 'John', age: 30 });
    });
  });

  describe('getSnapshot', () => {
    it('should return immutable snapshot of state', () => {
      const store = createTestStore();
      store.state.count = 10;

      const snapshot = store.getSnapshot();
      expect(snapshot.count).toBe(10);
    });

    it('should not be affected by subsequent mutations', () => {
      const store = createTestStore();
      store.state.count = 10;

      const snapshot = store.getSnapshot();
      store.state.count = 20;

      expect(snapshot.count).toBe(10);
      expect(store.state.count).toBe(20);
    });
  });

  describe('subscribe', () => {
    it('should notify on state change', async () => {
      const store = createTestStore();
      const listener = jest.fn();

      store.subscribe(listener);
      store.state.count = 5;

      // Wait for Valtio's async notification
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(listener).toHaveBeenCalled();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ count: 5 }),
        expect.objectContaining({ count: 0 }),
      );
    });

    it('should return unsubscribe function', async () => {
      const store = createTestStore();
      const listener = jest.fn();

      const unsubscribe = store.subscribe(listener);
      unsubscribe();

      store.state.count = 5;
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(listener).not.toHaveBeenCalled();
    });

    it('should notify multiple listeners', async () => {
      const store = createTestStore();
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      store.subscribe(listener1);
      store.subscribe(listener2);
      store.state.count = 5;

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe('subscribeKey', () => {
    it('should notify when specific key changes', async () => {
      const store = createTestStore();
      const listener = jest.fn();

      store.subscribeKey('count', listener);
      store.state.count = 5;

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(listener).toHaveBeenCalled();
    });

    it('should return unsubscribe function', async () => {
      const store = createTestStore();
      const listener = jest.fn();

      const unsubscribe = store.subscribeKey('count', listener);
      unsubscribe();

      store.state.count = 5;
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('onMutation', () => {
    it('should return unsubscribe function', () => {
      const store = createTestStore();
      const listener = jest.fn();

      const unsubscribe = store.onMutation(listener);
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });
  });

  describe('reset', () => {
    it('should reset state to initial values', async () => {
      const store = createTestStore();

      store.state.count = 10;
      store.state.items.push('item1', 'item2');
      store.state.user = { name: 'John', age: 30 };

      store.reset();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(store.state.count).toBe(0);
      expect(store.state.items).toEqual([]);
      expect(store.state.user).toBeNull();
    });

    it('should reset with new initial state', () => {
      const store = createTestStore();

      store.state.count = 10;
      store.reset({ count: 5 });

      expect(store.state.count).toBe(5);
      expect(store.state.items).toEqual([]);
    });
  });

  describe('batch', () => {
    it('should allow multiple mutations in batch', () => {
      const store = createTestStore();

      store.batch((state) => {
        state.count = 5;
        state.items.push('item1');
        state.user = { name: 'Jane', age: 25 };
      });

      expect(store.state.count).toBe(5);
      expect(store.state.items).toEqual(['item1']);
      expect(store.state.user).toEqual({ name: 'Jane', age: 25 });
    });
  });

  describe('dev mode', () => {
    it('should create store with dev mode enabled', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const store = createMcpStore({
        initialState: { count: 0 },
        devMode: true,
        name: 'test-store',
      });

      store.state.count = 5;

      // Valtio notifications are async
      setTimeout(() => {
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
      }, 10);
    });
  });

  describe('persistence', () => {
    let mockStorage: Storage;

    beforeEach(() => {
      mockStorage = {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
        length: 0,
        key: jest.fn(),
      };
    });

    it('should persist state with custom key', async () => {
      const store = createMcpStore({
        initialState: { count: 0 },
        persist: 'custom-key',
        storage: mockStorage,
      });

      store.state.count = 5;

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockStorage.setItem).toHaveBeenCalledWith('custom-key', expect.any(String));
    });

    it('should load persisted state', () => {
      (mockStorage.getItem as jest.Mock).mockReturnValue(JSON.stringify({ count: 42 }));

      const store = createMcpStore({
        initialState: { count: 0 },
        persist: 'test-key',
        storage: mockStorage,
      });

      expect(store.state.count).toBe(42);
    });

    it('should use initial state if no persisted state', () => {
      (mockStorage.getItem as jest.Mock).mockReturnValue(null);

      const store = createMcpStore({
        initialState: { count: 10 },
        persist: 'test-key',
        storage: mockStorage,
      });

      expect(store.state.count).toBe(10);
    });
  });
});

describe('createAction', () => {
  it('should create a bound action', () => {
    const store = createMcpStore({
      initialState: { count: 0 },
    });

    const increment = createAction(store, (state) => {
      state.count++;
    });

    increment();

    expect(store.state.count).toBe(1);
  });

  it('should accept arguments', () => {
    const store = createMcpStore({
      initialState: { count: 0 },
    });

    const add = createAction(store, (state, amount: number) => {
      state.count += amount;
    });

    add(5);

    expect(store.state.count).toBe(5);
  });
});

describe('createAsyncAction', () => {
  it('should create an async action', async () => {
    const store = createMcpStore({
      initialState: { count: 0, loading: false },
    });

    const fetchData = createAsyncAction(store, async (state) => {
      state.loading = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      state.count = 42;
      state.loading = false;
      return 42;
    });

    expect(store.state.loading).toBe(false);

    const result = await fetchData();

    expect(result).toBe(42);
    expect(store.state.count).toBe(42);
    expect(store.state.loading).toBe(false);
  });
});

describe('createComputed', () => {
  it('should compute derived value from state', () => {
    const store = createMcpStore({
      initialState: { items: [1, 2, 3, 4, 5] },
    });

    const total = createComputed(store, (state) => {
      return state.items.reduce((sum, item) => sum + item, 0);
    });

    expect(total()).toBe(15);
  });

  it('should update when state changes', () => {
    const store = createMcpStore({
      initialState: { items: [1, 2, 3] },
    });

    const total = createComputed(store, (state) => {
      return state.items.reduce((sum, item) => sum + item, 0);
    });

    expect(total()).toBe(6);

    store.state.items.push(4);

    expect(total()).toBe(10);
  });
});

describe('createSelector', () => {
  it('should select value from state', () => {
    const store = createMcpStore({
      initialState: { user: { name: 'John', age: 30 } },
    });

    const selectName = createSelector(store, (state) => state.user.name);

    expect(selectName()).toBe('John');
  });

  it('should update when selected value changes', () => {
    const store = createMcpStore({
      initialState: { user: { name: 'John', age: 30 } },
    });

    const selectName = createSelector(store, (state) => state.user.name);

    expect(selectName()).toBe('John');

    store.state.user.name = 'Jane';

    expect(selectName()).toBe('Jane');
  });
});
